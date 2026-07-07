import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveMeeting, Meeting, MeetingMode, RecordingInput, RecordingTranscriptLine } from '@iris/shared';
import { ProgressBar, Spinner } from '@/components/primitives';
import { Check } from '@/components/icons';
import { ApiError } from '@/lib/api';
import { useProcessAudioRecording, useProcessRecording } from '@/features/meetings/useMeetings';
import { PIPELINE_STEPS, browserRecognitionLocale, fmtMmss, speakerColor, sttLanguage } from './helpers';
import styles from './Recorder.module.css';

type Phase = 'idle' | 'recording' | 'processing' | 'done';

/** A transcript line as captured live (ts = elapsed seconds at finalization). */
interface FeedLine {
  tsSecs: number;
  tsLabel: string;
  speaker: string;
  text: string;
}

/**
 * Transcript lines are labelled by capture channel — the AI later attributes
 * them to named people from what was said. With call audio connected, live
 * channel diarization splits "You" (your mic) from "Call" (the shared tab).
 */
const MIC_ONLY_LABEL = 'Mic';

/**
 * Recognition languages. 'auto' is the default: the server's Whisper pass
 * auto-detects Hindi vs English per recording, and the live preview listens in
 * hi-IN (which handles mixed Hindi + English). The explicit locales below stay
 * as manual overrides for anyone who wants to pin one.
 */
const LANGS: readonly { code: string; label: string }[] = [
  { code: 'auto', label: 'Auto · Hindi + English' },
  { code: 'en-IN', label: 'English (India)' },
  { code: 'hi-IN', label: 'हिन्दी + English' },
  { code: 'en-US', label: 'English (US)' },
];
const LANG_STORAGE_KEY = 'iris.recorder.lang';

/** RMS energy above this counts as active voice on a channel. */
const VOICE_RMS = 0.015;

// ── Real audio capture (MediaRecorder → server-side Whisper) ─────────────────
const PREFERRED_AUDIO_MIME = 'audio/webm;codecs=opus';
const AUDIO_BITS_PER_SECOND = 48_000;
/** Chunk interval — collecting every second keeps long recordings resilient. */
const RECORDER_TIMESLICE_MS = 1000;

/** The best supported audio container, or null when MediaRecorder can't help. */
function recorderMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  if (MediaRecorder.isTypeSupported(PREFERRED_AUDIO_MIME)) return PREFERRED_AUDIO_MIME;
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return null;
}

/** Stops a recorder and resolves once its final chunk has been delivered. */
function stopRecorder(rec: MediaRecorder | null): Promise<void> {
  return new Promise((resolve) => {
    if (!rec || rec.state === 'inactive') {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    rec.onstop = finish;
    // Safety net: never let a stuck recorder block processing.
    window.setTimeout(finish, 2000);
    try {
      rec.stop();
    } catch {
      finish();
    }
  });
}

// ── Minimal Web Speech typings (Chromium ships webkitSpeechRecognition) ──────
interface SpeechAlternativeLike {
  transcript: string;
}
interface SpeechResultLike {
  isFinal: boolean;
  0: SpeechAlternativeLike;
}
interface SpeechEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechResultLike };
}
interface SpeechErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechEventLike) => void) | null;
  onerror: ((e: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Errors that end the session (everything else, e.g. no-speech, is transient). */
const FATAL_SPEECH_ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access was denied — allow the mic for this site and try again.',
  'service-not-allowed': 'The speech service is blocked in this browser profile.',
  'audio-capture': 'No microphone found — plug one in and try again.',
};

const REC_SUB: Record<MeetingMode, string> = {
  online: 'Live transcription · capture any call by sharing its tab audio',
  inroom: 'Records the room through your microphone · transcribed live',
};
const IDLE_HINT: Record<MeetingMode, string> = {
  online:
    'In any call — scheduled or not — connect the call audio (pick the meeting tab), then record. IRIS hears both sides, splits you from the call, and attributes speakers from what is said.',
  inroom:
    'One tap at the start of any in-room discussion. Pause anytime; everything is processed automatically when you stop.',
};

export interface RecorderProps {
  onViewMeeting: (m: Meeting) => void;
  /** A calendar meeting detected as happening right now (drives the banner + title). */
  liveMeeting: LiveMeeting | null;
  /** Bumped by the parent to scroll the recorder into view and flash it — never auto-starts. */
  focusSignal?: number;
  /** Suppress the built-in live banner when the parent is showing its own prompt for the same meeting. */
  hideLiveBanner?: boolean;
  /** Reports whether a recording is underway (recording or processing phase). */
  onActiveChange?: (active: boolean) => void;
}

/**
 * Live meeting recorder: real speech-to-text from the microphone (Web Speech,
 * Chrome/Edge) → real AI extraction on the server. Four phases: idle →
 * recording (live transcript, pause/resume) → processing → done.
 */
export function Recorder({ onViewMeeting, liveMeeting, focusSignal, hideLiveBanner, onActiveChange }: RecorderProps) {
  const [mode, setMode] = useState<MeetingMode>('inroom');
  const [phase, setPhase] = useState<Phase>('idle');
  const [secs, setSecs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [lines, setLines] = useState<FeedLine[]>([]);
  const [interim, setInterim] = useState('');
  const [stepIdx, setStepIdx] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [lang, setLang] = useState<string>(() => {
    try {
      return localStorage.getItem(LANG_STORAGE_KEY) ?? 'auto';
    } catch {
      return 'auto';
    }
  });
  const [callConnected, setCallConnected] = useState(false);
  const [callActive, setCallActive] = useState(false);
  // Brief highlight when the parent's live-meeting prompt focuses the recorder.
  const [flash, setFlash] = useState(false);

  // Refs mirror ticking state so intervals/handlers read current values.
  const secsRef = useRef(0);
  const pausedRef = useRef(false);
  const stoppingRef = useRef(false);
  const linesRef = useRef<FeedLine[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const payloadRef = useRef<RecordingInput | null>(null);
  const formRef = useRef<FormData | null>(null);
  const titleHintRef = useRef<string | null>(null);
  const calendarEventIdRef = useRef<string | null>(null);
  // Participant names known before processing (calendar attendees / extension-scraped);
  // sent to the server as AI attribution candidates so the other side gets a name.
  const attendeeNamesRef = useRef<string[]>([]);
  // Real audio capture: one recorder for the mic, one for the call tab (when connected).
  const micRecorderRef = useRef<MediaRecorder | null>(null);
  const callRecorderRef = useRef<MediaRecorder | null>(null);
  const micChunksRef = useRef<Blob[]>([]);
  const callChunksRef = useRef<Blob[]>([]);
  /** Mic stream acquired just for recording (only when no monitor stream exists). */
  const recMicStreamRef = useRef<MediaStream | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const langRef = useRef(lang);
  // Channel diarization: peak voice energy per channel since the last finalized line.
  const displayStreamRef = useRef<MediaStream | null>(null);
  const monitorStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const levelTimerRef = useRef<number | null>(null);
  const callConnectedRef = useRef(false);
  const peakTabRef = useRef(0);
  const peakMicRef = useRef(0);

  const processRecording = useProcessRecording();
  const processAudio = useProcessAudioRecording();
  const result = processAudio.data ?? processRecording.data ?? null;
  // Surface which engine actually produced the transcript so it's obvious at a
  // glance whether Gemini ran (vs the browser-preview fallback).
  const sttEngine = result?.meeting.sttEngine ?? null;
  const engineChip = sttEngine
    ? /^gemini/i.test(sttEngine)
      ? { text: 'Transcribed by Gemini', tone: 'accent' as const }
      : /^whisper/i.test(sttEngine)
        ? { text: 'Transcribed by Whisper', tone: 'accent' as const }
        : { text: 'Browser fallback — Gemini did not run', tone: 'warn' as const }
    : null;
  const pipelineDone = stepIdx >= PIPELINE_STEPS.length;
  const supported = useMemo(() => speechRecognitionCtor() !== null, []);

  // ── Recording clock ──
  useEffect(() => {
    if (phase !== 'recording') return;
    const tick = window.setInterval(() => {
      if (pausedRef.current) return;
      secsRef.current += 1;
      setSecs(secsRef.current);
    }, 1000);
    return () => window.clearInterval(tick);
  }, [phase]);

  // Keep the live transcript scrolled to the latest line.
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, interim]);

  // Parent bumped focusSignal (from the live-meeting prompt): bring the recorder
  // into view and flash it, but never start recording — the user still taps Start.
  useEffect(() => {
    if (!focusSignal) return;
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(true);
    flashTimerRef.current = window.setTimeout(() => setFlash(false), 1300);
    return () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    };
  }, [focusSignal]);

  // Let the parent hide its prompt while a recording is being captured or processed.
  useEffect(() => {
    onActiveChange?.(phase === 'recording' || phase === 'processing');
  }, [phase, onActiveChange]);

  /** Stops audio-level monitoring and releases the captured call/mic streams. */
  const teardownCallAudio = () => {
    if (levelTimerRef.current !== null) {
      window.clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    // Never kill the mic mid-recording: the mic recorder may be taping the
    // monitor stream — hand it over so stopping the tape releases it instead.
    const micRecState = micRecorderRef.current?.state;
    if (monitorStreamRef.current && (micRecState === 'recording' || micRecState === 'paused')) {
      recMicStreamRef.current = monitorStreamRef.current;
    } else {
      monitorStreamRef.current?.getTracks().forEach((t) => t.stop());
    }
    displayStreamRef.current = null;
    monitorStreamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    callConnectedRef.current = false;
    setCallConnected(false);
    setCallActive(false);
  };

  /** Abandons the audio recorders and releases the recording-only mic stream. */
  const teardownAudioCapture = () => {
    for (const rec of [micRecorderRef.current, callRecorderRef.current]) {
      try {
        if (rec && rec.state !== 'inactive') rec.stop();
      } catch {
        /* already stopped */
      }
    }
    micRecorderRef.current = null;
    callRecorderRef.current = null;
    micChunksRef.current = [];
    callChunksRef.current = [];
    recMicStreamRef.current?.getTracks().forEach((t) => t.stop());
    recMicStreamRef.current = null;
  };

  // Tear the recognizer + recorders + captured streams down if the component unmounts.
  // (Mount-only by design: the teardown reads refs, not render state.)
  useEffect(() => {
    return () => {
      stoppingRef.current = true;
      recognitionRef.current?.abort();
      teardownAudioCapture();
      teardownCallAudio();
    };
    // Both teardowns only touch refs, so an empty dependency list is safe.
  }, []);

  /**
   * Starts real audio capture alongside the live preview: a MediaRecorder on
   * the microphone, plus a second one on the call-tab audio when connected.
   * Failure is non-fatal — the live-transcript JSON path still works.
   */
  const startAudioCapture = async () => {
    const mimeType = recorderMimeType();
    if (!mimeType) return;
    try {
      // Acquire the mic once: reuse the monitor stream when call audio is connected.
      let micStream = monitorStreamRef.current;
      if (!micStream) {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recMicStreamRef.current = micStream;
      }
      // Stopped while the mic was being acquired — don't start a recorder nobody will stop.
      if (stoppingRef.current) {
        teardownAudioCapture();
        return;
      }
      micChunksRef.current = [];
      const micRec = new MediaRecorder(micStream, { mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
      micRec.ondataavailable = (e) => {
        if (e.data.size > 0) micChunksRef.current.push(e.data);
      };
      micRec.start(RECORDER_TIMESLICE_MS);
      micRecorderRef.current = micRec;

      const callTracks = displayStreamRef.current?.getAudioTracks() ?? [];
      if (callConnectedRef.current && callTracks.length > 0) {
        callChunksRef.current = [];
        const callRec = new MediaRecorder(new MediaStream(callTracks), {
          mimeType,
          audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
        });
        callRec.ondataavailable = (e) => {
          if (e.data.size > 0) callChunksRef.current.push(e.data);
        };
        callRec.start(RECORDER_TIMESLICE_MS);
        callRecorderRef.current = callRec;
      }
    } catch {
      // No audio capture (permission/stream race) — fall back to the preview path.
      teardownAudioCapture();
    }
  };

  /**
   * Connects the audio of ANY ongoing call: the user picks the meeting tab
   * (Meet/Zoom/Teams — anything), IRIS monitors its voice energy alongside the
   * mic, and finalized lines get channel-diarized as "You" vs "Call".
   */
  const connectCallAudio = async () => {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (!display.getAudioTracks().length) {
        display.getTracks().forEach((t) => t.stop());
        setMicError('No audio was shared — pick the meeting tab and tick "Also share tab audio".');
        return;
      }
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      displayStreamRef.current = display;
      monitorStreamRef.current = mic;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const mkAnalyser = (stream: MediaStream) => {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        return analyser;
      };
      const tabAnalyser = mkAnalyser(new MediaStream(display.getAudioTracks()));
      const micAnalyser = mkAnalyser(mic);
      const buf = new Float32Array(512);
      const rms = (analyser: AnalyserNode) => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
        return Math.sqrt(sum / buf.length);
      };
      levelTimerRef.current = window.setInterval(() => {
        const tab = rms(tabAnalyser);
        const micLevel = rms(micAnalyser);
        peakTabRef.current = Math.max(peakTabRef.current, tab);
        peakMicRef.current = Math.max(peakMicRef.current, micLevel);
        setCallActive(tab > VOICE_RMS);
      }, 120);

      // The user ending the share (browser UI) disconnects call capture.
      const videoTrack = display.getVideoTracks()[0];
      if (videoTrack) videoTrack.onended = () => teardownCallAudio();

      callConnectedRef.current = true;
      setCallConnected(true);
      setMicError(null);
    } catch {
      // Picker dismissed or permission denied — not an error state.
    }
  };

  /** Channel for a finalized line: dominant voice energy since the last line. */
  const channelLabel = (): string => {
    if (!callConnectedRef.current) return MIC_ONLY_LABEL;
    const label = peakTabRef.current > Math.max(peakMicRef.current * 1.15, VOICE_RMS) ? 'Call' : 'You';
    peakTabRef.current = 0;
    peakMicRef.current = 0;
    return label;
  };

  const appendLine = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const line: FeedLine = {
      tsSecs: secsRef.current,
      tsLabel: fmtMmss(secsRef.current),
      speaker: channelLabel(),
      text: trimmed,
    };
    linesRef.current = [...linesRef.current, line];
    setLines(linesRef.current);
  };

  /** Starts (or restarts) the browser speech recognizer. */
  const startRecognition = () => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = browserRecognitionLocale(langRef.current);
    recognition.onresult = (e) => {
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) appendLine(res[0].transcript);
        else pending += res[0].transcript;
      }
      setInterim(pending.trim());
    };
    recognition.onerror = (e) => {
      const fatal = FATAL_SPEECH_ERRORS[e.error];
      if (!fatal) return; // transient (no-speech, aborted, network blip) — onend restarts
      stoppingRef.current = true;
      setMicError(fatal);
      setPhase('idle');
    };
    recognition.onend = () => {
      // Chrome ends sessions on silence — keep listening until told to stop.
      if (!stoppingRef.current && !pausedRef.current) {
        try {
          recognition.start();
        } catch {
          /* already restarting */
        }
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setMicError('Could not start the microphone — is another recording running?');
      setPhase('idle');
    }
  };

  const pickLang = (code: string) => {
    setLang(code);
    langRef.current = code;
    try {
      localStorage.setItem(LANG_STORAGE_KEY, code);
    } catch {
      /* private mode */
    }
  };

  const start = () => {
    if (!supported) return;
    secsRef.current = 0;
    pausedRef.current = false;
    stoppingRef.current = false;
    linesRef.current = [];
    payloadRef.current = null;
    formRef.current = null;
    titleHintRef.current = liveMeeting?.title ?? null;
    calendarEventIdRef.current = liveMeeting?.id ?? null;
    attendeeNamesRef.current = liveMeeting?.attendeeNames ?? [];
    setSecs(0);
    setPaused(false);
    setLines([]);
    setInterim('');
    setMicError(null);
    setPhase('recording');
    startRecognition();
    void startAudioCapture();
  };

  const togglePause = () => {
    const next = !paused;
    pausedRef.current = next;
    setPaused(next);
    for (const rec of [micRecorderRef.current, callRecorderRef.current]) {
      try {
        if (next && rec?.state === 'recording') rec.pause();
        else if (!next && rec?.state === 'paused') rec.resume();
      } catch {
        /* recorder already stopped (e.g. share ended) */
      }
    }
    if (next) {
      recognitionRef.current?.stop();
      setInterim('');
    } else {
      startRecognition();
    }
  };

  /**
   * Assembles the captured audio and posts the multipart payload; when the
   * recorders produced no audio, falls back to the live-preview JSON path.
   */
  const finalize = async (transcript: RecordingTranscriptLine[], durationSecs: number) => {
    const micRec = micRecorderRef.current;
    const callRec = callRecorderRef.current;
    await Promise.all([stopRecorder(micRec), stopRecorder(callRec)]);
    micRecorderRef.current = null;
    callRecorderRef.current = null;
    recMicStreamRef.current?.getTracks().forEach((t) => t.stop());
    recMicStreamRef.current = null;

    const micBlob = micChunksRef.current.length
      ? new Blob(micChunksRef.current, { type: micRec?.mimeType || PREFERRED_AUDIO_MIME })
      : null;
    const callBlob = callChunksRef.current.length
      ? new Blob(callChunksRef.current, { type: callRec?.mimeType || PREFERRED_AUDIO_MIME })
      : null;
    micChunksRef.current = [];
    callChunksRef.current = [];

    // Audio path: the server transcribes with Whisper. Never send an empty mic blob.
    if (micBlob && micBlob.size > 0) {
      const form = new FormData();
      form.append('mic', micBlob, 'mic.webm');
      if (callBlob && callBlob.size > 0) form.append('call', callBlob, 'call.webm');
      form.append('mode', mode);
      form.append('durationSecs', String(durationSecs));
      if (titleHintRef.current) form.append('titleHint', titleHintRef.current);
      form.append('language', sttLanguage(langRef.current));
      if (calendarEventIdRef.current) form.append('calendarEventId', calendarEventIdRef.current);
      if (attendeeNamesRef.current.length) form.append('attendeeNames', JSON.stringify(attendeeNamesRef.current));
      form.append('preview', JSON.stringify(transcript));
      formRef.current = form;
      payloadRef.current = null;
      processAudio.mutate(form);
      return;
    }

    // Fallback: MediaRecorder unsupported or captured nothing — send the preview.
    if (!transcript.length) {
      setMicError('No speech was captured — nothing to process.');
      setPhase('idle');
      return;
    }
    const payload: RecordingInput = {
      mode,
      durationSecs,
      transcript,
      titleHint: titleHintRef.current,
      attendeeNames: attendeeNamesRef.current,
    };
    payloadRef.current = payload;
    formRef.current = null;
    processRecording.mutate(payload);
  };

  const stopAndProcess = () => {
    stoppingRef.current = true;
    recognitionRef.current?.stop();
    // Whatever is still interim belongs to the recording.
    if (interim.trim()) appendLine(interim);
    setInterim('');

    const transcript = linesRef.current.map((l) => ({ tsSecs: l.tsSecs, speaker: l.speaker, text: l.text }));
    setStepIdx(0);
    setPhase('processing');
    void finalize(transcript, Math.max(secsRef.current, 1));
  };

  // ── Processing: advance one pipeline chip per ~260ms ──
  // Kept brisk so the animation doesn't gate a fast (Gemini/inline) transcription.
  useEffect(() => {
    if (phase !== 'processing' || pipelineDone) return;
    const t = window.setInterval(() => setStepIdx((i) => Math.min(i + 1, PIPELINE_STEPS.length)), 260);
    return () => window.clearInterval(t);
  }, [phase, pipelineDone]);

  // Done only when BOTH the pipeline animation finished AND the POST resolved.
  useEffect(() => {
    if (phase === 'processing' && pipelineDone && result) setPhase('done');
  }, [phase, pipelineDone, result]);

  /** Re-POSTs the buffered payload (multipart or JSON) — the recording is never lost. */
  const retry = () => {
    setStepIdx(0);
    if (formRef.current) {
      processAudio.reset();
      processAudio.mutate(formRef.current);
    } else if (payloadRef.current) {
      processRecording.reset();
      processRecording.mutate(payloadRef.current);
    }
  };

  const reset = () => {
    secsRef.current = 0;
    pausedRef.current = false;
    stoppingRef.current = false;
    linesRef.current = [];
    payloadRef.current = null;
    formRef.current = null;
    titleHintRef.current = null;
    calendarEventIdRef.current = null;
    attendeeNamesRef.current = [];
    teardownAudioCapture();
    setPhase('idle');
    setSecs(0);
    setPaused(false);
    setLines([]);
    setInterim('');
    setStepIdx(0);
    setMicError(null);
    processRecording.reset();
    processAudio.reset();
  };

  const procError =
    processAudio.error instanceof ApiError
      ? processAudio.error
      : processRecording.error instanceof ApiError
        ? processRecording.error
        : null;
  const procPending = processAudio.isPending || processRecording.isPending;
  const procPct = Math.min(100, Math.round((stepIdx / PIPELINE_STEPS.length) * 100));

  return (
    <section ref={cardRef} className={`${styles.card} ${flash ? styles.cardFlash : ''}`}>
      {/* ── Header: title + status hint + mode segmented control ── */}
      <div className={styles.head}>
        <div className={styles.headLeft}>
          <h3 className={styles.headTitle}>Meeting recorder</h3>
          <span className={styles.headSub}>{REC_SUB[mode]}</span>
        </div>
        <div className={styles.headControls}>
          <select
            className={styles.langSelect}
            value={lang}
            onChange={(e) => pickLang(e.target.value)}
            aria-label="Transcription language"
            title="Transcription language — Auto detects Hindi vs English per recording; pick a locale to pin one"
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <div className={styles.modeTrack} role="group" aria-label="Recording mode">
            <button
              className={styles.modeTab}
              data-active={mode === 'inroom' ? 'true' : undefined}
              onClick={() => setMode('inroom')}
            >
              In-room
            </button>
            <button
              className={styles.modeTab}
              data-active={mode === 'online' ? 'true' : undefined}
              onClick={() => setMode('online')}
            >
              Online
            </button>
          </div>
        </div>
      </div>

      {/* ── Detected live meeting (from the synced calendar) ── */}
      {phase === 'idle' && liveMeeting && !hideLiveBanner && (
        <div className={styles.liveBanner}>
          <span className={styles.liveDot} />
          <span className={styles.liveText}>
            Meeting in progress — <strong>{liveMeeting.title}</strong>
            {liveMeeting.location ? ` · ${liveMeeting.location}` : ''}. Recording now links this note to it.
          </span>
        </div>
      )}

      {/* ── Idle ── */}
      {phase === 'idle' && (
        <>
          {micError && <div className={styles.micError}>{micError}</div>}
          {callConnected && (
            <div className={styles.callChipRow}>
              <span className={styles.callChip} data-active={callActive ? 'true' : undefined}>
                <span className={styles.callChipDot} />
                {callActive ? 'Call audio connected · voices detected' : 'Call audio connected · quiet'}
              </span>
              <button type="button" className={styles.callDisconnect} onClick={teardownCallAudio}>
                Disconnect
              </button>
            </div>
          )}
          <div className={styles.idleRow}>
            <button className={styles.recordBtn} onClick={start} disabled={!supported}>
              <span className={styles.recordDot} />
              {liveMeeting ? 'Record this meeting' : callActive ? 'Record this call' : 'Start recording'}
            </button>
            {mode === 'online' && !callConnected && (
              <button type="button" className={styles.captureBtn} onClick={() => void connectCallAudio()} disabled={!supported}>
                Connect call audio…
              </button>
            )}
            <div className={styles.idleHint}>
              {supported
                ? IDLE_HINT[mode]
                : 'Live transcription uses the browser speech engine — open IRIS in Chrome or Edge to record meetings.'}
            </div>
          </div>
        </>
      )}

      {/* ── Recording ── */}
      {phase === 'recording' && (
        <>
          <div className={styles.recRow}>
            <div className={styles.timerPill}>
              <span className={styles.timerDot} data-paused={paused ? 'true' : undefined} />
              <span className={styles.timer}>{fmtMmss(secs)}</span>
              <span className={styles.eq} data-paused={paused ? 'true' : undefined}>
                <span className={styles.eqBar} />
                <span className={styles.eqBar} />
                <span className={styles.eqBar} />
                <span className={styles.eqBar} />
              </span>
            </div>
            <span className={styles.recStatus}>
              {paused
                ? 'Paused — nothing is being captured'
                : callConnected
                  ? 'Recording · mic + call audio · you vs call auto-split'
                  : 'Recording · transcribing your microphone live'}
            </span>
            <div className={styles.recActions}>
              <button className={styles.secondaryBtn} onClick={togglePause}>
                {paused ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button className={styles.stopBtn} onClick={stopAndProcess}>
                ■ Stop &amp; process
              </button>
            </div>
          </div>
          <div className={styles.feed} ref={feedRef}>
            <div className={styles.feedKicker}>Live transcript · captured from your microphone</div>
            {lines.map((l, i) => (
              <div key={`${l.tsLabel}-${i}`} className={styles.feedLine}>
                <span className={styles.feedTs}>{l.tsLabel}</span>
                <span className={styles.feedSpeaker} style={{ color: speakerColor(l.speaker) }}>
                  {l.speaker}
                </span>
                <span className={styles.feedText}>{l.text}</span>
              </div>
            ))}
            {interim && (
              <div className={`${styles.feedLine} ${styles.feedInterim}`}>
                <span className={styles.feedTs}>{fmtMmss(secs)}</span>
                <span className={styles.feedSpeaker} style={{ color: speakerColor(MIC_ONLY_LABEL) }}>
                  {MIC_ONLY_LABEL}
                </span>
                <span className={styles.feedText}>{interim}</span>
              </div>
            )}
            {!paused && !interim && <div className={styles.listening}>Listening…</div>}
          </div>
        </>
      )}

      {/* ── Processing ── */}
      {phase === 'processing' &&
        (procError ? (
          <div className={styles.procError}>
            <div className={styles.procErrorText}>
              <div className={styles.procErrorMsg}>{procError.message}</div>
              {procError.recovery && <div className={styles.procErrorRecovery}>{procError.recovery}</div>}
            </div>
            <div className={styles.recActions}>
              <button className={styles.stopBtn} onClick={retry} disabled={procPending}>
                Try again
              </button>
              <button className={styles.secondaryBtn} onClick={reset}>
                Discard
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.procWrap}>
            <div className={styles.procHead}>
              <div className={styles.procTitleRow}>
                <Spinner size={16} />
                <span className={styles.procTitle}>
                  Transcribing &amp; extracting intelligence — accuracy first, longer recordings take a while
                </span>
              </div>
              <span className={styles.procPct}>{procPct}%</span>
            </div>
            <div className={styles.procBar}>
              <ProgressBar value={procPct} height={6} />
            </div>
            <div className={styles.pipeGrid}>
              {PIPELINE_STEPS.map((label, i) => {
                const state = i < stepIdx ? 'done' : i === stepIdx ? 'current' : 'pending';
                const mark = state === 'done' ? '✓' : state === 'current' ? '…' : '·';
                return (
                  <div key={label} className={styles.pipeChip} data-state={state}>
                    {mark} {label}
                  </div>
                );
              })}
            </div>
            {pipelineDone && !result && (
              <div className={styles.patienceRow}>
                <Spinner size={13} />
                <span>Still transcribing — accuracy over speed</span>
              </div>
            )}
          </div>
        ))}

      {/* ── Done ── */}
      {phase === 'done' && result && (
        <div className={styles.doneRow}>
          <span className={styles.doneCheck}>
            <Check size={16} strokeWidth={2.6} style={{ color: 'var(--success)' }} />
          </span>
          <div className={styles.doneMain}>
            <div className={styles.doneTitle}>Meeting processed &amp; saved</div>
            <div className={styles.doneChips}>
              {engineChip && (
                <span className={styles.doneChip} data-tone={engineChip.tone}>
                  {engineChip.text}
                </span>
              )}
              <span className={styles.doneChip} data-tone="info">
                Calendar event created · {result.calendarDateLabel}
              </span>
              <span className={styles.doneChip} data-tone="accent">
                {result.engagement.length > 0
                  ? `Engagement updated · ${result.engagement
                      .map((b) => `${b.name.split(' ')[0] ?? b.name} +${b.delta}`)
                      .join(' · ')}`
                  : 'Context updated'}
              </span>
              <span className={styles.doneChip} data-tone="warn">
                {result.openActionCount} actions extracted
              </span>
            </div>
          </div>
          <div className={styles.recActions}>
            <button className={styles.viewBtn} onClick={() => onViewMeeting(result.meeting)}>
              View meeting →
            </button>
            <button className={styles.secondaryBtn} onClick={reset}>
              Record another
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
