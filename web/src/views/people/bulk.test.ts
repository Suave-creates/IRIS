import { describe, expect, it } from 'vitest';
import { parseRoster } from './bulk';

const PLANNER_SNIPPET = `
const P = [
  {n:'Raj Pandey',      c:'Direct',   f:'Operations',       fr:'Daily',         l:'BWD', d:[1,2,3,4,5]},
  {n:'Vimal Kumar',     c:'Direct',   f:'WH',               fr:'Thrice a week', l:'BWD', d:[2,3,4]},       // Tue Wed Thu
  {n:'Ruchi',           c:'Direct',   f:'Quality/Projects', fr:'Thrice a week', l:'GGN', d:[1,3,4]},
];
`;

describe('parseRoster', () => {
  it('parses planner P-array entries, ignoring cadence and trailing comments', () => {
    const { people, issues } = parseRoster(PLANNER_SNIPPET);
    expect(issues).toEqual([]);
    expect(people).toHaveLength(3);
    expect(people[0]).toEqual({
      name: 'Raj Pandey',
      category: 'Direct',
      func: 'Operations',
      location: 'BWD',
      days: [1, 2, 3, 4, 5],
    });
    expect(people[2]!.func).toBe('Quality/Projects');
  });

  it('parses entries embedded in a whole HTML file, skipping CSS braces', () => {
    const html = `
      <style>.name-cell .nm{font-weight:500;font-size:12px;color:var(--text-primary)}</style>
      <script>
        const P = [{n:'Sagar', c:'Support', f:'Frame', fr:'Twice a week', l:'GGN', d:[1,4]}];
      </script>`;
    const { people, issues } = parseRoster(html);
    expect(issues).toEqual([]);
    expect(people).toEqual([{ name: 'Sagar', category: 'Support', func: 'Frame', location: 'GGN', days: [1, 4] }]);
  });

  it('parses a JSON array with long keys', () => {
    const json = JSON.stringify([
      { name: 'Krishan', category: 'Direct-1', func: 'Engineering', location: 'BWD', days: [2, 4, 5] },
    ]);
    const { people, issues } = parseRoster(json);
    expect(issues).toEqual([]);
    expect(people).toEqual([
      { name: 'Krishan', category: 'Direct-1', func: 'Engineering', location: 'BWD', days: [2, 4, 5] },
    ]);
  });

  it('canonicalizes case and drops rows with unknown enum values, with a reason', () => {
    const { people, issues } = parseRoster(
      `[{"name":"A","category":"direct","func":"operations","location":"ggn","days":[1]},
        {"name":"B","category":"Boss","func":"Operations","location":"BWD","days":[2]}]`,
    );
    expect(people).toEqual([{ name: 'A', category: 'Direct', func: 'Operations', location: 'GGN', days: [1] }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('unknown category "Boss"');
  });

  it('dedupes repeated names case-insensitively, keeping the first', () => {
    const { people, issues } = parseRoster(
      `[{"n":"Om","c":"Direct-1","f":"Frame","l":"BWD","d":[4]},
        {"n":"om","c":"Agent","f":"KPI","l":"GGN","d":[3]}]`,
    );
    expect(people).toHaveLength(1);
    expect(people[0]!.category).toBe('Direct-1');
    expect(issues[0]).toContain('duplicated in the paste');
  });

  it('sanitizes days (dedupe, sort, clamp to 1..6) and tolerates a missing days field', () => {
    const { people } = parseRoster(`[{"n":"A","c":"Direct","f":"WH","l":"BWD","d":[5,2,2,9,0]}]`);
    expect(people[0]!.days).toEqual([2, 5]);
    const { people: noDays } = parseRoster(`[{"n":"B","c":"Direct","f":"WH","l":"BWD"}]`);
    expect(noDays[0]!.days).toEqual([]);
  });

  it('reports unrecognizable input instead of failing silently', () => {
    const { people, issues } = parseRoster('just some prose with no entries');
    expect(people).toEqual([]);
    expect(issues).toHaveLength(1);
    const empty = parseRoster('   ');
    expect(empty.people).toEqual([]);
    expect(empty.issues).toEqual([]);
  });

  it('unescapes backslash-escaped quotes in planner names', () => {
    const { people, issues } = parseRoster(`{n:'D\\'Souza', c:'Direct', f:'WH', l:'BWD', d:[1]},`);
    expect(issues).toEqual([]);
    expect(people).toEqual([{ name: "D'Souza", category: 'Direct', func: 'WH', location: 'BWD', days: [1] }]);
  });

  it('accepts a bare JSON object and a {people: [...]} wrapper', () => {
    const single = parseRoster(`{"n":"Asha","c":"Direct","f":"WH","l":"BWD","d":[1,2]}`);
    expect(single.people).toEqual([{ name: 'Asha', category: 'Direct', func: 'WH', location: 'BWD', days: [1, 2] }]);
    const wrapped = parseRoster(
      `{"people":[{"name":"Riya","category":"Direct-1","func":"HR","location":"BWD","days":[3,6]}]}`,
    );
    expect(wrapped.people).toHaveLength(1);
    expect(wrapped.people[0]!.name).toBe('Riya');
  });

  it('parses quoted day values in the loose path', () => {
    const { people, issues } = parseRoster(`{n:'Asha', c:'Direct', f:'WH', l:'BWD', d:['1','3']},`);
    expect(issues).toEqual([]);
    expect(people[0]!.days).toEqual([1, 3]);
  });

  it('flags a row whose days were all invalid instead of dropping them silently', () => {
    const { people, issues } = parseRoster(`[{"n":"Asha","c":"Direct","f":"WH","l":"BWD","d":[0,9]}]`);
    expect(people[0]!.days).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('no valid days');
  });

  it('survives one level of nested braces inside an entry', () => {
    const { people } = parseRoster(`{n:'Asha', meta:{x:1}, c:'Direct', f:'WH', l:'BWD', d:[2]},`);
    expect(people).toEqual([{ name: 'Asha', category: 'Direct', func: 'WH', location: 'BWD', days: [2] }]);
  });

  it('accepts new site codes like HYD (locations are user-extensible) and uppercases them', () => {
    const { people, issues } = parseRoster(
      `[{"n":"A","c":"Direct","f":"WH","l":"hyd","d":[1]},{"n":"B","c":"Agent","f":"KPI","l":"Pune","d":[2]}]`,
    );
    expect(issues).toEqual([]);
    expect(people[0]!.location).toBe('HYD');
    expect(people[1]!.location).toBe('PUNE');
  });

  it('drops rows with invalid location codes, with a reason', () => {
    const { people, issues } = parseRoster(`[{"n":"C","c":"Direct","f":"WH","l":"a b!","d":[1]}]`);
    expect(people).toEqual([]);
    expect(issues[0]).toContain('invalid location');
  });
});
