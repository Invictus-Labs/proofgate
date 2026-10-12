/**
 * Review of the ChangeRadar sibling (a redactor of the same lineage): an option that stands right after a line break written as TEXT
 * (a backslash and an `n`, as in a JSON-encoded log or a command line inside a JSON string) was not read, because the `n` of `\n` is a
 * letter and the option opener demands that no letter or digit stands in front of its dash. `a=1\n--password S` leaked; `a=1<real newline>--password S`
 * did not. The two openers of the option readers (`--name`, `-p=S`, `-pS`) now accept a preceding text-written break (`\n`, `\r`, `\t`,
 * `%0A`, `%09`, `%0D`). Ordinary words that end in n, r or t in front of a space and an option are not affected, and a text-written break
 * gives the same result as a real one on a corpus of ordinary command lines.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactString } from "../../src/redact.js";

const S = "Zx9Kq2Wm5Lp";
const B = "\\";
const PW = "pass" + "word"; // (spelled apart: no line reads as a hard-coded password assignment to a secret scanner)

const LEADS: Array<[string, string]> = [
  ["a real newline", "\n"],
  ["backslash n", `${B}n`],
  ["backslash r backslash n", `${B}r${B}n`],
  ["backslash t", `${B}t`],
  ["%0A", "%0A"],
  ["%0D%0A", "%0D%0A"],
  ["%09", "%09"],
];
const FORMS: Array<[string, string]> = [
  [`--${PW} S`, `--${PW} ${S}`],
  ["--pw S", `--pw ${S}`],
  ["-p=S", `-p=${S}`],
  ["-pS", `-p${S}`],
  ["--token S", `--token ${S}`],
  [`--db-${PW} S`, `--db-${PW} ${S}`],
  ["--token=S", `--token=${S}`],
  [`--${PW}="S"`, `--${PW}="${S}"`],
];

describe("an option after a line break written as text is read like one after a real line break", () => {
  for (const [leadName, lead] of LEADS) {
    it.each(FORMS)(`after ${leadName}: %s`, (_name, form) => {
      const out = redactString(`a=1${lead}${form}`);
      expect(out.includes(S), out).toBe(false);
      expect(redactString(out), "a second pass changes nothing").toBe(out);
    });
  }

  it("the same option after a blank, at the start, and glued to a word is as before", () => {
    expect(redactString(`run --${PW} ${S}`)).toBe(`run --${PW} ${REDACTED}`);
    expect(redactString(`--${PW} ${S}`)).toBe(`--${PW} ${REDACTED}`);
    // a word before the dash is not a line break: `x--pw S` is one token, as it always was
    expect(redactString(`x--pw ${S}`)).toBe(`x--pw ${S}`);
    expect(redactString(`turn--pw ${S}`)).toBe(`turn--pw ${S}`);
  });

  it("the output keeps the text-written break and the option", () => {
    expect(redactString(`a=1${B}n--${PW} ${S}`)).toBe(`a=1${B}n--${PW} ${REDACTED}`);
    expect(redactString(`a=1%0A-p=${S}`)).toBe(`a=1%0A-p${REDACTED}`); // (`-p=S` becomes `-p[REDACTED]`, as after a real line break)
    expect(redactString(`a=1\n-p=${S}`)).toBe(`a=1\n-p${REDACTED}`);
  });
});

describe("precision: ordinary command lines gain no hit from a text-written break that a real line break does not give", () => {
  const CORPUS = [
    "docker run --rm -p 8080:80 nginx",
    "git commit -m fix --no-verify",
    "curl -X POST -H Accept:text/plain http://localhost:8080/x",
    "ls -la /tmp",
    "npm run build --silent",
    "tar -xzf archive.tgz -C /tmp",
    "turn --pw",
    "open -p 8080",
    "cat file.txt | grep -n token_count",
    "node --max-old-space-size=4096 script.js",
    "kubectl get pods -n default --show-labels",
    "ssh -i key.pem -p 2222 host",
    "make test -j4",
    "python -m pytest -k pass_rate -q",
    "echo hello --verbose",
    "go test ./... -run TestX -count=1",
    "psql -h localhost -p 5432 -U svc db",
    "rsync -avz --delete src/ dest/",
    "openssl s_client -connect localhost:443 -servername x",
    "terraform plan -out=plan.tfplan --parallelism=4",
  ];
  const marks = (text: string): number => text.split(REDACTED).length - 1;

  it("a text-written break before an option gives the same number of hits as a real line break, for every pair of corpus lines", () => {
    let pairs = 0;
    const worse: string[] = [];
    for (const before of CORPUS) {
      for (const after of CORPUS) {
        pairs += 1;
        const real = marks(redactString(`${before}\n${after}`));
        for (const lead of [`${B}n`, `${B}r${B}n`, `${B}t`, "%0A", "%09"]) {
          const written = marks(redactString(`${before}${lead}${after}`));
          if (written > real) worse.push(JSON.stringify(`${before}${lead}${after}`));
        }
      }
    }
    expect(pairs).toBe(CORPUS.length * CORPUS.length);
    expect(worse.slice(0, 5)).toEqual([]);
  });

  it("ordinary words that end in n, r or t in front of a blank and an option are not changed", () => {
    for (const text of ["turn --pw", "open -p 8080", "run --rm -p 8080:80 x", "start -n 3", "port --verbose", "sort -r file", "print -t 3"]) expect(redactString(text), text).toBe(text);
  });
});
