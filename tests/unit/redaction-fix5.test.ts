/**
 * Review round 5, conformance review of the round-4 tree: forms that the documented promise "a YAML value on the next line is found"
 * covers but that leaked (block scalars `|` and `>` with their indicators, anchors and tags in front of the value), assignment
 * operators next to `=` (`?=`, `+=`, and `:=`, which printed a redaction marker next to a visible secret), long options with a
 * prefix (`--db-password S`) and `-p=S`. Each form is tested at JSON nesting depth 0 to 8. The shapes that stay unredacted are
 * pinned in the last block, so the documented list and the behaviour cannot drift apart.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactString, redactValue } from "../../src/redact.js";
import { DEPTHS, nest } from "../helpers/redaction-templates.js";

const S = "Hs7Zq9BlockXy";
const fixedPoint = (text: string): boolean => redactString(redactString(text)) === redactString(text);

const BLOCKS: Array<[string, string]> = [
  ["literal block", `password: |\n  ${S}`],
  ["folded block, strip", `password: >-\n  ${S}`],
  ["literal block, keep", `password: |+\n  ${S}\n`],
  ["explicit indentation digit", `password: |2\n    ${S}`],
  ["digit then chomping", `password: >2-\n    ${S}`],
  ["token, folded block", `token: >\n  ${S}`],
  ["an anchor in front of the value", `password: &a ${S}`],
  ["a tag in front of the value", `password: !!str ${S}`],
  ["a tag and an anchor, value on the next line", `password: !!str &a\n  ${S}`],
  ["a verbatim tag", `password: !<tag:yaml.org,2002:str> ${S}`],
  ["a tag in front of a block scalar", `password: !!str |\n  ${S}`],
  ["an anchor in front of a block scalar", `password: &a |\n  ${S}`],
  ["CRLF line breaks", `api_key: |\r\n  ${S}`],
  ["a comment after the header", `password: | # note\n  ${S}`],
  ["two lines in the block", `password: |\n  ${S}\n  ${S}y\nnext: 1`],
  ["a blank line inside the block", `password: |\n  ${S}\n\n  ${S}z\nnext: 1`],
  ["a key inside a nested mapping, with a sibling", `db:\n  password: |\n    ${S}\n    ${S}y\n  host: sibling`],
  ["a key in a list item", `env:\n  - password: |\n      ${S}\n  - name: other`],
  ["no indentation (cannot be told from the next key)", `password: |\n${S}\nnext: 1`],
  ["tab indentation written as text", `password: |\n\t${S}`],
  // No blank between the colon and the `&` or `!`: that is not a YAML node property (a mapping colon is followed by a blank), it is
  // the start of the value, and the secret behind it must go (the old reader redacted these; a property skip must not lose them).
  ["a value that starts with & right after the colon", `token:&${S}`],
  ["a value that starts with ! right after the colon", `password:!${S}`],
  ["an ampersand value followed by more text", `api_key:&${S} rest`],
  ["a tag-like value glued to the secret", `secret:!!str${S}`],
  ["an ampersand value at the end of a line", `password:&${S}\nnext: 1`],
];

describe("YAML block scalars and node properties after a credential key, at nesting depth 0 to 8", () => {
  for (const [name, text] of BLOCKS) {
    it(name, () => {
      const failures: string[] = [];
      for (const k of DEPTHS) {
        const out = redactString(nest(text, k));
        if (out.includes(S)) failures.push(`depth ${k}: ${JSON.stringify(out).slice(0, 90)}`);
        if (!fixedPoint(nest(text, k))) failures.push(`depth ${k}: not a fixed point`);
      }
      expect(failures).toEqual([]);
    });
  }

  it("the block ends where its indentation ends: what follows is kept (exact output)", () => {
    expect(redactString(`db:\n  password: |\n    ${S}\n    ${S}y\n  host: sibling\n`)).toBe(`db:\n  password: |\n    ${REDACTED}\n  host: sibling\n`);
    expect(redactString(`password: |\n  ${S}\nnext: 1`)).toBe(`password: |\n  ${REDACTED}\nnext: 1`);
    expect(redactString(`password: |\r\n  ${S}\r\nnext: 1`)).toBe(`password: |\r\n  ${REDACTED}\r\nnext: 1`);
    expect(redactString(`password: >-\n  ${S}\n\n  ${S}z\nnext: 1`)).toBe(`password: >-\n  ${REDACTED}\nnext: 1`);
    // A property is not skipped (a secret may start with `!` or `&`): the whole line is the value; a non-indented next line is kept.
    expect(redactString(`password: !!str &a ${S} rest`)).toBe(`password: ${REDACTED}`);
    expect(redactString(`password: !Pass123\nnext: 1`)).toBe(`password: ${REDACTED}\nnext: 1`);
    expect(redactString(`token:&${S} rest`)).toBe(`token:${REDACTED} rest`);
    // (a property that ends its line, with an indented line below: that line is taken too, so the sibling below goes with it)
    expect(redactString(`db:\n  password: !Pass123\n  host: x`)).toBe(`db:\n  password: ${REDACTED}`);
    // a block scalar behind a tag: the tag goes with it (a secret may start with `!`)
    expect(redactString(`password: !!str |\n  ${S}\nnext: 1`)).toBe(`password: ${REDACTED}\nnext: 1`);
  });

  it("with an explicit indentation digit every indented line belongs to the block", () => {
    expect(redactString(`password: |2\n    ${S}\n  ${S}y\nnext: 1`)).toBe(`password: |2\n    ${REDACTED}\nnext: 1`);
  });

  it("the same exact outputs at every nesting depth (the escaped line break ends a line, so what follows is kept)", () => {
    const CASES: Array<[string, string, string]> = [
      [`password: |\n  ${S}\nkeepmarker: 1`, `password: |\n  ${REDACTED}\nkeepmarker: 1`, "keepmarker"],
      [`db:\n  password: >-\n    ${S}\n    ${S}y\n  host: keepmarker`, `db:\n  password: >-\n    ${REDACTED}\n  host: keepmarker`, "keepmarker"],
      [`password: | # note\n  ${S}\nkeepmarker: 1`, `password: | # note\n  ${REDACTED}\nkeepmarker: 1`, "keepmarker"],
    ];
    for (const [text, expected, marker] of CASES) {
      // At depth 1 and deeper the line breaks are the two characters backslash and n; the word that follows the block must survive.
      for (const k of DEPTHS) {
        const out = redactString(nest(text, k));
        expect(out.includes(S), `depth ${k}`).toBe(false);
        expect(out, `depth ${k}: what follows the block is kept`).toContain(marker);
      }
      expect(redactString(text)).toBe(expected);
    }
  });

  it("a block that ends in a colon, or starts with a quote, is still one block", () => {
    expect(redactString(`password: |\n  ${S}:\nnext: 1`)).toBe(`password: |\n  ${REDACTED}\nnext: 1`);
    for (const k of DEPTHS) {
      // (written as text the line break is not a real one, and a value that ends in a colon takes the next word: not for a block)
      const out = redactString(nest(`password: |\n  ${S}:\nkeepmarker: 1`, k));
      expect(out.includes(S), `depth ${k}`).toBe(false);
      expect(out, `depth ${k}`).toContain("keepmarker");
    }
    expect(redactString(`password: |\n  "${S}"\nnext: 1`)).toBe(`password: |\n  ${REDACTED}\nnext: 1`);
    expect(redactString(`password: |\n  '${S}' and more\nnext: 1`)).toBe(`password: |\n  ${REDACTED}\nnext: 1`);
  });

  it("controls: a block under a name that is not a credential is returned as written", () => {
    for (const text of ["description: |\n  the password is rotated monthly\nnext: 1", "note: >-\n  keep this\n", "script: |\n  echo hello\n  echo there\n"]) {
      expect(redactString(text), text).toBe(text);
    }
  });

  it("a credential name inside a longer key is a credential name, so its block is redacted too", () => {
    expect(redactString("password_policy: |\n  rotate monthly\n")).not.toContain("rotate monthly");
  });

  it("an empty block scalar is left as the plain value it was", () => {
    expect(redactString("password: |")).not.toContain("password: |\n");
  });
});

describe("assignment operators next to =", () => {
  const OPERATORS: Array<[string, string]> = [
    ["?= (make, shell)", `PASSWORD ?= ${S}`],
    ["+= (make, shell)", `PASSWORD += ${S}`],
    [":= (make, Go)", `password := ${S}`],
    [":= without blanks", `password:=${S}`],
    ["?= without blanks", `api_key?=${S} rest`],
    ["+= inside a line", `export TOKEN+=${S} && run`],
  ];
  for (const [name, text] of OPERATORS) {
    it(name, () => {
      for (const k of DEPTHS) {
        const out = redactString(nest(text, k));
        expect(out.includes(S), `depth ${k}: ${out.slice(0, 80)}`).toBe(false);
        expect(out.includes(`${REDACTED} `) || out.endsWith(REDACTED), `depth ${k}: the marker stands where the secret was`).toBe(true);
      }
    });
  }

  it("exact output: the marker replaces the whole value, never sits beside a visible secret", () => {
    expect(redactString(`password := ${S}`)).toBe(`password := ${REDACTED}`);
    expect(redactString(`PASSWORD ?= ${S} rest`)).toBe(`PASSWORD ?= ${REDACTED} rest`);
    expect(redactString(`PASSWORD += ${S}`)).toBe(`PASSWORD += ${REDACTED}`);
    expect(redactString(`password:=${S}`)).toBe(`password:=${REDACTED}`);
  });

  it("controls: the same operators after a name that is not a credential, and a YAML colon before a value that starts with =", () => {
    for (const text of ["label := value", "x:=1", "path ?= /usr/bin", "count += 1", "status: ok"]) expect(redactString(text), text).toBe(text);
  });

  it("a YAML key with a value that starts with an equals sign is still a YAML value", () => {
    expect(redactString("password: =abc123")).not.toContain("abc123");
  });
});

describe("options: -p=S and a prefix in front of the name", () => {
  const FLAGS: Array<[string, string]> = [
    ["-p=S", `mysql -p=${S} db`],
    ["--db-password S", `run --db-password ${S} --verbose`],
    ["--db-password=S", `run --db-password=${S} --verbose`],
    ["--admin-token=S", `run --admin-token=${S}`],
    ["--client-secret S", `run --client-secret ${S} x`],
    ["--redis-cache-password S (three segments)", `run --redis-cache-password ${S} x`],
    ["-db-password S", `run -db-password ${S} x`],
  ];
  for (const [name, text] of FLAGS) {
    it(name, () => {
      for (const k of DEPTHS) expect(redactString(nest(text, k)).includes(S), `depth ${k}`).toBe(false);
      expect(fixedPoint(text)).toBe(true);
    });
  }

  it("exact output", () => {
    expect(redactString(`run --db-password ${S} --verbose`)).toBe(`run --db-password ${REDACTED} --verbose`);
    expect(redactString(`mysql -p=${S} db`)).toBe(`mysql -p${REDACTED} db`);
  });

  it("controls: ordinary options are returned as written", () => {
    for (const text of ["run --no-color x", "run --token-count 5", "run --passenger x", "run --compass north", "gcc -pipe -O2 x.c", "run --db-name main", "tool -p= x", "run --tokenizer bpe"]) {
      expect(redactString(text), text).toBe(text);
    }
  });
});

describe("shapes that are NOT redacted (documented in docs/INTERFACES.md, pinned here)", () => {
  const CYRILLIC_A = String.fromCodePoint(0x430);
  const TEXT: Array<[string, string]> = [
    ["a Dockerfile ENV line with a space", `ENV PASSWORD ${S}`],
    ["a typed assignment", `password: string = "${S}"`],
    ["a JSON-escaped key name", `pass${"\\"}u0077ord=${S}`],
    ["a look-alike letter in the key name", `p${CYRILLIC_A}ssword=${S}`],
    ["a value after ->", `password -> ${S}`],
    ["an XML element", `<password>${S}</password>`],
    ["a text key longer than about 88 characters", `token_${"a".repeat(100)}=${S}`],
    ["a control character inside the keyword", `pass${String.fromCharCode(8)}word=${S}`],
    ["a single-letter option with a space", `tool -p ${S}`],
    ["a separator in percent escapes four levels deep", `password%2525253D${S}`],
    ["more than 64 blanks between the key and its value", `password:${" ".repeat(65)}${S}`],
    ["a tab written as text around the equals sign", `password${"\\"}t=${"\\"}t${S}`],
    ["a folded multi-line double-quoted value", `password: "A\n  ${S}"`],
    ["a single-quoted Python string with an escaped quote inside JSON text", JSON.stringify(`{'DB_PASSWORD': 'Aq7Zx91${"\\"}'${S}'}`)],
    ["a name/value pair written as two YAML lines", `name: DB_PASSWORD\nvalue: ${S}\n`],
    ["a pair whose value key is past the 4 KiB window", `{"name":"DB_PASSWORD","gap":"${"g".repeat(5000)}","value":"${S}"}`],
    ["a pair whose label spans lines", `{"name":"first line\\nDB_PASSWORD","value":"${S}"}`],
    ["a password with a slash and no at sign within 512 characters of it", `url //svc:hd/${"m".repeat(600)}${S}@host.example/db ok`],
  ];
  it.each(TEXT)("%s", (_name, text) => {
    expect(redactString(text)).toContain(S);
  });

  // Round 5 (conformance P2 and P3): shapes that a reviewer showed to leak and that are documented, one by one, in the interface document.
  // The word "password" is spelled from a constant in the two forms a secret scanner would take for a hard-coded assignment.
  const B = "\\";
  const MORE_TEXT: Array<[string, string]> = [
    // a value that ends at its first blank
    ["a value of several words after a credential key", `password: correct ${S} battery`],
    ["a passphrase of several words", `passphrase: alpha bravo ${S} delta`],
    ["an environment assignment of several words", `PASSWORD=alpha bravo ${S}`],
    // YAML forms
    ["a plain scalar continued on the next line", `password: alpha\n  ${S}`],
    ["a nested block sequence", `password:\n  - - ${S}`],
    ["a nested block sequence after an item", `password:\n  - a\n  - - ${S}`],
    ["a nested block sequence on its own line", `password:\n  -\n    - ${S}`],
    ["a YAML single quote written twice inside the value", `password: 'it''s ${S}'`],
    ["a complex key", `? password\n: ${S}`],
    // Python and shell literals
    ["a triple-quoted string", `password = """${S}"""`],
    ["adjacent string literals", `password = 'ab' '${S}'`],
    ["blanks escaped with a backslash", `password=abc${B} def${B} ${S}`],
    ["a line continuation after the equals sign", `password=${B}\n${S}`],
    // command lines that name the credential in one word and give it in another
    ["put-parameter --name ... --value", `aws ssm put-parameter --name /prod/db/password --value ${S}`],
    ["--name N --value V", `tool --name DB_PASSWORD --value ${S}`],
    ["gh secret set NAME --body V", `gh secret set DB_PASSWORD --body ${S}`],
    ["aws configure set NAME V", `aws configure set aws_secret_access_key ${S}`],
    ["git config NAME V", `git config user.password ${S}`],
    ["npm config set NAME V", `npm config set _authToken ${S}`],
    ["setenv NAME V", `setenv PASSWORD ${S}`],
    ["a single-letter option -P with a value", `tool -P ${S}`],
    ["-P=S", `tool -P=${S}`],
    ["redis-cli -a S", `redis-cli -a ${S}`],
    ["mongosh -p S", `mongosh -p ${S}`],
    // Python pairs written as tuples
    ["a tuple pair", `("password", "${S}")`],
    ["a list of tuple pairs", `[('password', '${S}')]`],
    ["dict_items", `dict_items([('password', '${S}')])`],
    // escaped and encoded spellings of a separator or of key letters
    ["a separator written as \\u003d", `password${B}u003d${S}`],
    ["a separator written as \\x3d", `password${B}x3d${S}`],
    ["a letter of the key written as a percent escape", `pass%77ord=${S}`],
    ["a separator written as an HTML entity", `password&#61;${S}`],
    ["a separator written as a hexadecimal HTML entity", `password&#x3D;${S}`],
    ["JSON written with &quot;", `{&quot;password&quot;:&quot;${S}&quot;}`],
    ["a key and its colon on separate lines in JSON", `{"password"\n  :\n  "${S}"}`],
    // names that the object rule knows and the text rule does not
    ["seed_phrase", `seed_phrase=${S}`],
    ["unseal_key", `unseal_key=${S}`],
    ["recovery_code", `recovery_code=${S}`],
    ["pin_code", `pin_code=${S}`],
    ["key_data", `key_data=${S}`],
    ["subscription_key", `subscription_key=${S}`],
    ["Ocp-Apim-Subscription-Key", `Ocp-Apim-Subscription-Key: ${S}`],
    ["kek", `kek=${S}`],
    ["hmac", `hmac=${S}`],
    ["wallet_key", `wallet_key=${S}`],
    ["passw", `passw=${S}`],
    ["pword", `pword=${S}`],
    ["cred", `cred=${S}`],
    ["creds", `creds=${S}`],
    ["Pass", `Pass=${S}`],
    ["bearerx in text", `bearerx=${S}`],
    ["a hub signature header", `X-Hub-Signature-256: sha256=${S}`],
    // session cookie names as text (they are credential names in pairs and lists only)
    ["sid as text", `sid=${S}`],
    ["session as text", `session=${S}`],
    ["PHPSESSID as text", `PHPSESSID=${S}`],
    ["connect.sid as text", `connect.sid=${S}`],
    ["a cookie option", `curl -b "sid=${S}" x`],
    // markup and SQL
    ["an HTML input", `<input name="password" value="${S}">`],
    ["an XML add element", `<add key="password" value="${S}"/>`],
    ["CREATE USER ... IDENTIFIED BY", `CREATE USER u IDENTIFIED BY '${S}'`],
    ["ALTER USER ... PASSWORD", `ALTER USER u PASSWORD '${S}'`],
    // characters inside a keyword
    ["a no-break space inside the keyword", `pass${String.fromCharCode(0xa0)}word=${S}`],
    ["a Braille blank inside the keyword", `pass${String.fromCharCode(0x2800)}word=${S}`],
  ];
  it.each(MORE_TEXT)("%s", (_name, text) => {
    expect(redactString(text)).toContain(S);
  });

  const OBJECTS: Array<[string, unknown]> = [
    ["a {k, v} pair", { k: "DB_PASSWORD", v: S }],
    ["a {label, text} pair", { label: "DB_PASSWORD", text: S }],
    ["a {field, val} pair", { field: "DB_PASSWORD", val: S }],
    ["a {name, data} pair", { name: "DB_PASSWORD", data: S }],
    ["the short name otp", { otp: S }],
    ["the short name pin", { pin: S }],
    ["the short name priv", { priv: S }],
    ["the short name salt", { salt: S }],
    ["the name bearerx", { bearerx: S }],
    ["a pair whose label is longer than 1,100 characters", { name: `${"x".repeat(1200)}_password`, value: S }],
    ["a pair whose label spans lines", { name: "first line\nDB_PASSWORD", value: S }],
  ];
  it.each(OBJECTS)("%s", (_name, doc) => {
    expect(JSON.stringify(redactValue(doc))).toContain(S);
  });
});
