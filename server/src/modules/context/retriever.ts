import type { Candidate } from './gather.js';

export interface ScoredCandidate extends Candidate {
  /** Final relevance score, 0–1. */
  score: number;
}

/**
 * Pluggable relevance ranker. The default implementation uses lexical overlap +
 * recency + a per-type base weight — no external embedding service required.
 * Swap this for a vector-backed retriever later without touching the engine.
 */
export interface Retriever {
  rank(query: string, candidates: Candidate[]): ScoredCandidate[];
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are',
  'was', 'were', 'be', 'been', 'do', 'does', 'did', 'can', 'you', 'your', 'i', 'me', 'my',
  'we', 'our', 'it', 'this', 'that', 'at', 'by', 'as', 'from', 'about', 'please', 'help',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Recency score in [0,1] with a ~14-day half-life; unknown/future → 1. */
function recencyScore(ts: number): number {
  if (!ts) return 0.3;
  const ageDays = (Date.now() - ts) / 86_400_000;
  if (ageDays <= 0) return 1;
  return Math.max(0.1, Math.pow(0.5, ageDays / 14));
}

export class LexicalRecencyRetriever implements Retriever {
  rank(query: string, candidates: Candidate[]): ScoredCandidate[] {
    const q = tokenize(query);
    return candidates
      .map((c) => {
        const ct = tokenize(c.text);
        let overlap = 0;
        for (const w of q) if (ct.has(w)) overlap++;
        const lexical = q.size ? overlap / q.size : 0; // 0–1
        const recency = recencyScore(c.recencyTs);
        // Weighted blend: lexical dominates, recency + base weight modulate.
        const score = 0.6 * lexical + 0.2 * recency + 0.2 * c.baseWeight;
        return { ...c, score };
      })
      .sort((a, b) => b.score - a.score);
  }
}

export const defaultRetriever: Retriever = new LexicalRecencyRetriever();
