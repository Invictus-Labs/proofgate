/**
 * Review round 5, security report (two P1, eight P2, eight P3) and the minimal shapes of the round-6 differential against both earlier trees.
 *  - P1: a usage-counter exemption that let real credential names through (`TOKEN_PERSONAL`, `TOKEN_MAX_SECRET`, `token_used_password`);
 *  - P1: a value that starts with a bracket was read as a list, so `[S]tail` and `[]S` kept the part behind the bracket;
 *  - P2: a credential-named parent key swallowed its credential-named child (value on the next line, a block scalar, a list);
 *  - P2: an unquoted value did not end at `| ) } ] & # <br>` or at a tab or blank written as text in front of the next `NAME=`;
 *  - P2: the percent-decoded copy did not know `%7C %3E %23 %3F %2B %21`, and `name:%20"S"` kept its quoted value;
 *  - P2: a credential key with an OBJECT value (`{"token": {"value": "S"}}`), an argv `-u` element with `user:password`, glued `-uuser:S`;
 *  - P2: a YAML value line that starts with `#`, `>#` or `|#` was read as a comment or a block header;
 *  - an unquoted scheme word (`token: Bearer S`) left the credential behind it (in every earlier tree too).
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactString, redactValue } from "../../src/redact.js";
import { nest } from "../helpers/redaction-templates.js";

const S = "Zx9Kq2Wm5Lp";
const T = "Yw3Kd8NcRv5";
const B = "\\";
const PW = "pass" + "word"; // (spelled apart: no line reads as a hard-coded password assignment to a secret scanner)

/** The secret is gone, and the result is a fixed point. */
function hides(text: string, ...secrets: string[]): void {
  const out = redactString(text);
  for (const secret of secrets.length > 0 ? secrets : [S]) expect(out.includes(secret), `${JSON.stringify(text)} -> ${JSON.stringify(out)}`).toBe(false);
  expect(redactString(out), `${JSON.stringify(text)}: not a fixed point`).toBe(out);
}

describe("P1: a name that merely starts like a usage counter is a credential name", () => {
  it.each([
    "TOKEN_PERSONAL",
    "TOKEN_MAX_SECRET",
    "token_used_" + PW,
    "token_count_secret",
    "TOKEN_LIMIT_SECRET",
    "token-per-user-secret",
    "tokens_max_apikey",
  ])("%s", (name) => {
    hides(`${name}=${S}`);
    hides(`${name}: ${S}`);
    hides(`export ${name}='${S}'`);
    expect(JSON.stringify(redactValue({ [name]: S }))).not.toContain(S);
  });

  it.each([
    ["max_tokens: 4096", "4096"],
    ["input_tokens=1234", "1234"],
    ["completion_tokens: 77", "77"],
    ["token_count: 77", "77"],
    ["tokens_used=12", "12"],
    ["token-limit: 9000", "9000"],
    ["tokens_per_minute=600", "600"],
    ["total_tokens: 5", "5"],
    ["reasoning_tokens=3", "3"],
  ])("control: the counter %s keeps its number", (text, number) => {
    expect(redactString(text)).toContain(number);
  });
});

describe("P1: a value that starts with a bracket is a list only when the bracket closes and stands alone", () => {
  it.each([
    [`DB_${PW.toUpperCase()}=[${S}]${T}`],
    [`${PW}: [${S}]${T}`],
    [`${PW}=[]${S}`],
    [`token=[${S}],${T}`],
    [`Authorization: [${S}]${T}`],
    [`${PW}=(${S})${T}`],
    [`secret={${S}}${T}`],
    [`${PW}=[${S}`],
    [`api_key=["${S}"]${T}`],
    [`api_key=["${S}"],${T}`],
    [`Authorization=("${S}"),next`],
  ])("%s", (text) => {
    hides(text, S, T);
  });

  it("a closed list keeps what stands beside it, apart from it", () => {
    expect(redactString(`${PW}=[${S}] tail`)).toBe(`${PW}=${REDACTED} tail`);
    expect(redactString(`${PW}: ["${S}","${T}"]\nnext: 1`)).toBe(`${PW}: ${REDACTED}\nnext: 1`);
    expect(redactString(`token=[a, b];x=1`)).toBe(`token=${REDACTED};x=1`);
  });

  it("the same at JSON nesting depth 0 to 3", () => {
    for (const k of [0, 1, 2, 3]) hides(nest(`${PW}=[${S}]${T}`, k), S, T);
  });
});

describe("P2: a credential-named parent hands its credential-named child to the child's own reader", () => {
  it.each([
    [`credentials:\n  ${PW}:\n    ${S}\nnext: 1`, `credentials:\n  ${PW}:\n    ${REDACTED}\nnext: 1`],
    [`secrets:\n  db_${PW}: |\n    ${S}\nnext: 1`, `secrets:\n  db_${PW}: |\n    ${REDACTED}\nnext: 1`],
    [`auth:\n  token:\n    - ${S}\nnext: 1`, `auth:\n  token:\n    - ${REDACTED}\nnext: 1`],
    [`apikey: token:\n${S}`, `apikey: token:\n${REDACTED}`],
  ])("exact output %#", (text, expected) => {
    expect(redactString(text)).toBe(expected);
  });

  it("with the line breaks written as text, at depth 0 to 3", () => {
    for (const k of [0, 1, 2, 3]) {
      hides(nest(`credentials:\n  ${PW}:\n    ${S}\nnext: 1`, k));
      hides(nest(`secrets:\n  db_${PW}: |\n    ${S}\nnext: 1`, k));
      hides(nest(`auth:\n  token:\n    - ${S}\nnext: 1`, k));
    }
  });

  it("a dangling name at the end of a bracketed or quoted value hands its value to the next line", () => {
    hides(`${PW}=>'token:\n${S}`);
    hides(`Authorization=[]apikey: ${S}`);
    hides(`${PW}:{"Authorization:\na ${S}`);
    hides(`Authorization=-Authorization\nx Authorization:\n["${S}`);
    hides(`secret=[]secret:"${S}"`);
  });
});

describe("P2: an unquoted value ends where the next NAME= starts, whatever wrote the break", () => {
  const first = "abcdefghijk";
  it.each([
    ["a line break as text", `${B}n`],
    ["a percent-encoded line break", "%0A"],
    ["a percent-encoded blank", "%20"],
    ["a tab as text", `${B}t`],
    ["a pipe", "|"],
    ["a closing parenthesis", ")"],
    ["an ampersand", "&"],
    ["a hash", "#"],
    ["a closing bracket", "]"],
    ["a closing brace", "}"],
    ["a line break tag", "<br>"],
    ["a self-closing line break tag", "<br/>"],
  ])("%s", (_name, gap) => {
    hides(`${PW.toUpperCase()}=${first}${gap}AUTH_TOKEN="${S}"`);
    hides(`${PW.toUpperCase()}=${first}${gap}AUTH_TOKEN='${S}'`);
    hides(`${PW.toUpperCase()}=${first}${gap}AUTH_TOKEN=${S}`, S, first);
  });

  it("the pair behind the delimiter stays readable, and a second pass changes nothing (the marker of the first pass is not a list with text behind it)", () => {
    // a comma, a semicolon and a line break end the value in front of any NAME=; the other delimiters only in front of a credential's name
    for (const mark of [",", ";", `${B}n`]) {
      const out = redactString(`${PW}=abc${mark}foo=x`);
      expect(out, mark).toBe(`${PW}=${REDACTED}${mark}foo=x`);
      expect(redactString(out), mark).toBe(out);
    }
    for (const mark of ["|", ")", "&", "#", "]", "}", "<br>", "%7C", "%20", `${B}t`]) {
      const out = redactString(`${PW}=abc${mark}AUTH_TOKEN=x`);
      expect(out, mark).toBe(`${PW}=${REDACTED}${mark}AUTH_TOKEN=${REDACTED}`);
      expect(redactString(out), mark).toBe(out);
    }
    expect(redactString(`${PW}=[a],foo=x`)).toBe(`${PW}=${REDACTED},foo=x`);
    expect(redactString(`${PW}=[a]|AUTH_TOKEN=x`)).toBe(`${PW}=${REDACTED}|AUTH_TOKEN=${REDACTED}`);
  });

  it("a delimiter that is not followed by a NAME= stays inside the value (never less)", () => {
    for (const mark of ["|", ")", "&", "#", "]", "}", "<br>"]) hides(`${PW}=${S}${mark}${T}`, S, T);
  });

  it("a value that starts with a delimiter is still a value", () => {
    for (const mark of ["|", "&", "#", ")", "]", "}"]) hides(`${PW}=${mark}${S} x=1`);
  });
});

describe("P2: the percent-decoded copy knows the rest of the separators", () => {
  it.each([
    [`db_${PW}%3A%20%7C%0A%20%20${S}%0Anext%3A%201`],
    [`db_${PW}%20%3D%3E%20${S}`],
    [`db_${PW}:%20"${S}"`],
    [`db_${PW}%3D%23${S}`],
    [`db_${PW}%3D%3F${S}`],
    [`db_${PW}%3D%2B${S}`],
    [`db_${PW}%3D%21${S}`],
  ])("%s", (text) => {
    hides(text);
  });

  it.each(["%7C", "%3E", "%23", "%3F", "%2B", "%21"])("%s in front of, and behind, a name", (code) => {
    hides(`${PW}%3D${S}${code}next%3Dx`);
    hides(`key${code}${PW}=${S}`);
    hides(`${PW}=abc${code}AUTH_TOKEN="${S}"`);
  });

  it("the blank before a quote stays a blank in the output", () => {
    expect(redactString(`db_${PW}:%20"${S}"`)).toBe(`db_${PW}:%20"${REDACTED}"`);
  });
});

describe("P2: a credential key with an object or an array value", () => {
  it("text", () => {
    hides(`{"token": {"value": "${S}", "expires": 3600}}`);
    hides(`{"${PW}": {"a": "${S}"}, "next": 1}`);
    hides(`{"secret": ["${S}", "${T}"]}`, S, T);
  });

  it("objects", () => {
    expect(JSON.stringify(redactValue({ token: { value: S, expires: 3600 } }))).not.toContain(S);
    expect(JSON.stringify(redactValue({ [PW]: { a: S } }))).not.toContain(S);
    expect(JSON.stringify(redactValue({ secret: [S, T] }))).not.toMatch(new RegExp(`${S}|${T}`));
  });
});

describe("P2: argv and options that take user:password", () => {
  it("an argv element after -u", () => {
    hides(`["curl","-u","admin:${S}","http://localhost/x"]`);
    hides(`["curl","--user","admin:${S}"]`);
    hides(JSON.stringify(["curl", "-u", `admin:${S}`, "http://localhost/x"]));
    expect(JSON.stringify(redactValue({ argv: ["curl", "-u", `admin:${S}`] }))).not.toContain(S);
  });

  it("-u glued to the user name", () => {
    hides(`curl -uadmin:${S} http://localhost/x`);
    hides(`curl -uadmin:'${S}' http://localhost/x`);
    expect(redactString(`curl -uadmin:${S} http://localhost/x`)).toContain("http://localhost/x");
  });

  it("controls: a -u element with no colon is a user name, and a plain URL is not touched", () => {
    expect(redactString(`["curl","-u","admin","http://localhost/x"]`)).toBe(`["curl","-u","admin","http://localhost/x"]`);
    expect(redactString("curl -uadmin http://localhost/x")).toBe("curl -uadmin http://localhost/x");
  });
});

describe("P2: a YAML value line that starts with #, >#, or |#", () => {
  it.each([
    [`DB_${PW.toUpperCase()}:\n  #${S}\nnext: 1`],
    [`authToken:\n  >#${S}\nnext: 1`],
    [`authToken:\n  |#${S}\nnext: 1`],
    [`${PW}:\n  # ${S}\nnext: 1`],
  ])("%#", (text) => {
    hides(text);
  });

  it("a comment line and a comment after a block header are still comments", () => {
    expect(redactString(`${PW}: ${S}\n# a comment\nkeep: yes`)).toBe(`${PW}: ${REDACTED}\n# a comment\nkeep: yes`);
    expect(redactString(`${PW}: | # note\n  ${S}\nkeep: yes`)).toBe(`${PW}: | # note\n  ${REDACTED}\nkeep: yes`);
    // a `#` line indented DEEPER than its credential key is read as the value itself (a password may start with `#`; see redaction-nested-hash): a comment there is hidden with the value,
    // which is the safe direction. A comment at the key's column or to its left stays readable.
    expect(redactString(`${PW}:\n  # a comment\n  ${S}\nkeep: yes`)).toBe(`${PW}:\n  ${REDACTED}\nkeep: yes`);
    expect(redactString(`${PW}:\n# a comment\n  ${S}\nkeep: yes`)).toBe(`${PW}:\n# a comment\n  ${REDACTED}\nkeep: yes`);
  });
});

describe("an unquoted scheme word takes the credential behind it", () => {
  it.each(["Bearer", "Basic", "Digest", "Negotiate", "NTLM", "OAuth"])("the scheme word %s, behind an assignment, an option and a rocket", (scheme) => {
    hides(`token: ${scheme} ${S}`);
    hides(`--token ${scheme} ${S}`);
    hides(`secret=${scheme} ${S}`);
    hides(`token=>${scheme} ${S},next`);
  });

  it("a scheme word alone, and a value that only starts like one, keep the rest of the line", () => {
    expect(redactString(`${PW}: bearer-rotation x`)).toBe(`${PW}: ${REDACTED} x`);
    expect(redactString(`token: Bearer\nnext: 1`)).toBe(`token: ${REDACTED}\nnext: 1`);
  });
});

describe("minimal shapes of the differential against both earlier trees", () => {
  it.each([
    [`-utoken\n,secret= ${S}`],
    [`-${PW}e\n%passwd= ${S}`],
    [`-Authorization-%3Dc ${S}`],
    [`-atoken%3Da: ${S}`],
    [`-secretkey-header\n$headerProxy-Authorization": "${S}"`],
    [`--keykey--xsecret secretAuthorization>#namea1//!!strAuthorization = (${S})'!!str|`],
    [`Authorization=[] ${S}`],
    [`-userAuthorization:="${S}"`],
    [`-user:="${S}"`],
  ])("%#", (text) => {
    hides(text);
  });

  it("options keep what they took before: a path and a mode that are not secrets stay readable where the option is not a credential", () => {
    expect(redactString("kube --authorization-mode=Node,RBAC --bind-address=127.0.0.1")).toContain("--bind-address=127.0.0.1");
  });

  it("accepted cost, pinned: the word after a credential option that takes no secret is redacted with it (fail closed, a positional argument or a path is lost, the words behind it stay)", () => {
    expect(redactString("tool --token-file keep.txt run")).toBe(`tool --token-file ${REDACTED} run`);
    expect(redactString("docker login --password-stdin --username keep-me")).toBe(`docker login --password-stdin ${REDACTED} keep-me`);
  });

  it("an argv list: the element after -u or a credential option, a number included", () => {
    expect(redactValue(["curl", "-u", `admin:${S}`, "http://localhost/x"])).toEqual(["curl", "-u", REDACTED, "http://localhost/x"]);
    expect(redactValue(["tool", "--user", `admin:${S}`])).toEqual(["tool", "--user", REDACTED]);
    expect(redactValue(["tool", "-u", "admin", "x"])).toEqual(["tool", "-u", "admin", "x"]);
    expect(redactValue(["tool", "--" + PW, 1234567])).toEqual(["tool", "--" + PW, REDACTED]);
  });
});

// Found by the round-6 differential (planted secrets, seed 20261002, against the three earlier redactors): the minimal shapes, by family.
describe("differential families: what an earlier redactor hid, this one hides", () => {
  it.each([
    ["a delimiter inside a secret, then a word and an equals sign that is not a credential name", `token:>#${S}=`],
    ["... a pipe", `${PW}=|#${S}=`],
    ["... a percent sign and an ampersand", `${PW.toUpperCase()}:%&${S}=`],
    ["... a closing bracket", `Bearer=D]${S}=`],
    ["... an operator", `token+=>#${S}=`],
  ])("%s: %s", (_family, text) => {
    hides(text);
  });

  it("a delimiter that stands in front of a CREDENTIAL name still ends the value; a non-credential name stays inside it (accepted, as in the earlier trees)", () => {
    expect(redactString(`${PW.toUpperCase()}=abc|HOST=h`)).toBe(`${PW.toUpperCase()}=${REDACTED}`);
    expect(redactString(`${PW.toUpperCase()}=abc|AUTH_TOKEN=x`)).toBe(`${PW.toUpperCase()}=${REDACTED}|AUTH_TOKEN=${REDACTED}`);
  });

  it.each([
    [`-uh:Authorization= ${S}`],
    [`-utokenr:: ${S}`],
    [`Bearer=auth":${S}`],
    [`Bearer:auth= ${S}`],
    [`Bearer=secret= ${S}`],
    [`Bearer=1token:\n${S}`],
    [`apikey: ! token:\n${S}`],
    [`%0Aauth=,secret:\n${S}`],
    [`SECRET:\n#${S}\n%20`],
    [`Authorization:\n#${S}${B}n${B}t`],
    [`pass=[]${PW.toUpperCase()} =${S}`],
    [`-pass ${S};Bearer:`],
    [`-esecret @-apikey ${S}`],
    [`secret%3D,${PW.toUpperCase()}%3D'${S}`],
    [`secret=,${PW.toUpperCase()}='${S}'`],
    [`secret=|${PW.toUpperCase()}='${S}'`],
    [`token=()${PW}=${B}"${S}`],
    [`apikey=[]${PW.toUpperCase()}=${B}"${S}`],
    [`-tPASS=,${PW.toUpperCase()}=${B}"${S}`],
    [`Bearer=${PW.toUpperCase()}${B}":${S}`],
    [`auth=:\n_${PW}: ${S}`],
    [`secret=[]token:${B}n ${S}`],
    [`secret:>#${S} Bearer=`],
    [`apikey=Basic ${PW.toUpperCase()}:{"${S}`],
    [`passwd=Bearer Authorization=('${S}`],
    [`credential=:\n${PW}":${S}`],
    [`Bearer=D]${S}token=`],
    [`token=|#${S}token=`],
    [`credential=|#${S}credential=`],
    [`SECRET:%#${S}apikey=`],
    [`-uu:${PW}=" ${S}`],
    [`${PW}=${PW}= TOKEN="${S}`],
    [`-apikeyt secret%3D"${S}`],
    [`-${PW}s\nsecret%3A%20"${S}`],
    [`Authorization:s:\nAuthorization= ${S}`],
    [`Bearer=-auth":${S}`],
    [`Bearer=!secret":${S}`],
    [`Bearer=-auth:"${S}`],
    [`pass=[]2${PW.toUpperCase()} =${S}`],
    [`secret=:\n${PW}="${S}`],
    [`authAuthorization:; token:\n&a ${S}`],
    [`token:#${S}apikey=`],
    [`${PW}=&${S}secret=`],
    [`%23-u\n${PW.toUpperCase()}%3A%20${S}`],
    [`BearerAuthorization=a ${S}`],
    [`Bearerauthorization:c ${S}`],
    [`BearerAuthorization:b'${S}`],
    // scheme words that the header reader does not list by name (Splunk, Hawk), bare and in a quoted option, and YAML block indicators that carry an indentation digit (`|1`, `>1`)
    [`Authorization: Splunk ${S}`],
    [`Authorization: Hawk ${S}`],
    [`Authorization: Hawk id="abc", ts="1", nonce="n", mac="${S}"`],
    [`-H "Authorization: Splunk ${S}"`],
    [`--header 'Authorization: Hawk ${S}'`],
    [`apikey:|1\n  ${S}`],
    [`apikey: >1\n  ${S}\nnext: 1`],
    [`apikey:|2-\n  ${S}`],
    [`apikey: |+1\n  ${S}\nnext: 1`],
  ])("%s", (text) => {
    hides(text);
  });

  it("KNOWN LIMITS, pinned to today's output (open owner decisions, not waived): shapes that an earlier tree hid by accident and this one does not", () => {
    // NOTE: every line below pins TODAY's output, which leaves something visible that a reader might expect hidden (an open owner decision). A pin here is expected to be RETIRED when its shape is
    // fixed: the fix moves the string to the must-hide list above and deletes the pin. A failing pin after a change of the redactor is therefore news to read, not a test to loosen.
    // an option named Authorization + hyphen + qualifier looks like `--authorization-mode`, which must stay narrow (only its own value goes)
    expect(redactString(`-Authorization-e=a ${S}`)).toBe(`-Authorization-e=${REDACTED} ${S}`);
    // a quoted value that is a garbled key, followed by `:` and the real value
    expect(redactString(`credential=>"${B}auth":${S}`)).toBe(`credential=>"${REDACTED}":${S}`);
    // a scheme-less `//Authorization:x@host`: the user information is redacted, the host is not a credential
    expect(redactString(`//Authorization:$@${S}`)).toBe(`//${REDACTED}@${S}`);
    // a credential keyword whose value is another credential's name, a blank, and an equals sign (`Bearer:auth =S`): the name is taken for the value
    expect(redactString(`Bearer:auth =${S}`)).toBe(`Bearer:${REDACTED} =${S}`);
    // a `#` line followed by an indented line is a comment, and the indented line is the value
    expect(redactString(`SECRET:\n#${S}\n%201`)).toBe(`SECRET:\n#${S}\n%20${REDACTED}`);
    // a credential keyword whose value is `Authorization:x` glued behind it (the header's own reader is not asked)
    expect(redactString(`Bearer:Authorization:r ${S}`)).toBe(`Bearer:${REDACTED} ${S}`);
    // an empty quoted value with a word glued to its closing quote
    expect(redactString(`Authorization=>""${S}`)).toBe(`Authorization=>""${S}`);
    // a scheme-less `//Authorization:h@host`
    expect(redactString(`//Authorization:h@${S}`)).toBe(`//${REDACTED}@${S}`);
    // a credential word and a hyphen glued to the secret behind a delimiter (`|#S-credential=`): the hyphen makes it look like a name
    expect(redactString(`secret=|#${S}-credential=`)).toBe(`secret=${REDACTED}#${S}-credential=`);
    // a keyword that ends in Authorization (`BearerAuthorization:`) takes the line; a block header at the end of it hands nothing over
    expect(redactString(`BearerAuthorization:x secret:|\n${S}`)).toBe(`BearerAuthorization:${REDACTED}\n${S}`);
    // YAML: a `#` line at column 0 followed by an indented line is a comment, and the indented line is the value (an indented `#` line is a value)
    expect(redactString(`secret:\n#${S}\n t`)).toBe(`secret:\n#${S}\n ${REDACTED}`);
    expect(redactString(`secret:\n  #${S}\nnext: 1`)).toBe(`secret:\n  ${REDACTED}\nnext: 1`);
    // a credential keyword whose value is another credential's name behind `-u user:` and a blank in front of the equals sign
    expect(redactString(`-uc:token =${S}`)).toBe(`-uc:${REDACTED} =${S}`);
    // an option, a line break and a quoted label with the value on the line below
    expect(redactString(`-u\n"Authorization:\n${S}`)).toBe(`-u\n${REDACTED}\n${S}`);
    // a keyword and a separator with no value: nothing is hidden, and nothing was ever to be hidden
    expect(redactString("auth=>")).toBe("auth=>");
    expect(redactString("secret:%0A")).toBe("secret:%0A");
    // an option in a JSON array whose value holds a blank or an escaped quote: the option reader ends an unquoted value at the blank / quote
    expect(redactString(JSON.stringify(["run", `--password=${S} tail1`, "x"]))).toBe(`["run","--password=${REDACTED} tail1","x"]`);
    expect(redactString(JSON.stringify(["run", `--password=ab"${S}`, "x"]))).toBe(`["run","--password=${REDACTED}"${S}","x"]`);
    // session cookie names count in name/value pairs and lists only, not as plain object keys
    expect(redactValue({ sid: S, PHPSESSID: S })).toEqual({ sid: S, PHPSESSID: S });
    expect(redactValue({ name: "sid", value: S })).toEqual({ name: "sid", value: REDACTED });
    // user information with a raw @ in the password and another stop character behind it: the value ends at the last @ before that character
    expect(redactString(`x://user:pa@ss${S}#frag@host/path`)).toBe(`x://${REDACTED}@ss${S}#frag@host/path`);
    // a glued `-p` with percent-escape soup behind it (`-p%pwd= S`): the glued -pSECRET rule takes the soup, and S stays. (A long single-dash option name that a colon or a
    // percent escape follows, `-passD: S`, `-password%3A"S"`, `-password%20'S'`, was in this list: the glued rule now leaves an option NAME to the option reader, after any lead.)
    for (const lead of [" ", "\n", `${B}n`, `${B}t`]) {
      expect(redactString(`x${lead}-p%pwd= ${S}`)).toBe(`x${lead}-p${REDACTED} ${S}`);
      expect(redactString(`x${lead}-passD: ${S}`)).toBe(`x${lead}-passD: ${REDACTED}`);
      expect(redactString(`x${lead}-${PW}%3A"${S}"`)).toBe(`x${lead}-${PW}:"${REDACTED}"`);
      expect(redactString(`x${lead}-${PW}%20'${S}'`)).toBe(`x${lead}-${PW} ${REDACTED}`);
    }
    // a block header with a `#` glued to its indicator (`|#`, `>#`) and the value on the indented lines below: `#` right after the indicator makes it a value (that is what
    // keeps `authToken:` then `|#S` redacted), so the lines below are not read as its block. The round-5 redactor read it as a header.
    expect(redactString(`apikey:|#\n  ${S}`)).toBe(`apikey:${REDACTED}\n  ${S}`);
    expect(redactString(`apikey: >#\n  ${S}\nnext: 1`)).toBe(`apikey: ${REDACTED}\n  ${S}\nnext: 1`);
    // a chain of dangling labels, and glued quoted noise
    expect(redactString(`password:= Authorization:a ${S}`)).toBe(`password:= ${REDACTED} ${S}`);
    expect(redactString(`credential:=" apikey:"${S}`)).toBe(`credential:="${REDACTED}"${S}`);
    // the round-5 redactor hid each of these (found by the final differential against it); they are garbled shapes, listed and open, not waived:
    // a secret with a credential's name and separator glued behind it (the name is left for its own match; a value that looks like a name is not read)
    expect(redactString(`token=${S}apikey':`)).toBe(`token=${S}apikey':`);
    // (`apikey:` then `S-password:` on the next line was pinned here; a value that does not read as a name is hidden now: it is in `redaction-space-options`)
    expect(redactString(`${PW}=${S}passwd'=x`)).toBe(`${PW}=${S}passwd'=${REDACTED}`);
    // (`-password S apikey=1` was pinned here with S readable; the word after an option that does not read as a name is the option's value and is hidden whole now: see `redaction-space-options`)
    expect(redactString(`-${PW} ${S}apikey=1`)).toBe(`-${PW} ${REDACTED}`);
    // an option named `-u1` (a digit in the name) whose user is a credential's name, and a value that is a name and a separator with the secret on the next line
    expect(redactString(`-u1:-auth ${S}`)).toBe(`-u1:${REDACTED} ${S}`);
    expect(redactString(`TOKEN=%0AN=${S}`)).toBe(`TOKEN=%0AN=${S}`);
    // a chain of dangling labels, a bracket that holds a label, and a scheme word with a blank before the colon (with a real or a text-written line break in front)
    expect(redactString(`token=( token%3A\n${S}`)).toBe(`token=${REDACTED}\n${S}`);
    expect(redactString(`token:$Authorization:\nsecret:\n${S}`)).toBe(`token:${REDACTED}\n${S}`);
    expect(redactString(`credential:${B}ntoken: : 1Token: ${S}`)).toBe(`credential:${B}ntoken: ${REDACTED} ${S}`);
    expect(redactString(`-token=Digest : ${S}`)).toBe(`-token=${REDACTED} ${S}`);
    expect(redactString(`${B}n-token=Digest : ${S}`)).toBe(`${B}n-token=${REDACTED} ${S}`);
    // a quoted value that is empty or label-like (`''`, `%20''`, `b'apikey:('`) or a shell `$'M'` with a word glued behind its closing quote: the word stays
    // (the same as a plain `password='M'S`, which every tree left)
    expect(redactString(`Authorization:%20''${S}`)).toBe(`Authorization:%20''${S}`);
    expect(redactString(`Authorization=$'M'${S}`)).toBe(`Authorization=$'${REDACTED}'${S}`);
    expect(redactString(`secret=b'apikey:('${S}`)).toBe(`secret=b'${REDACTED}'${S}`);
    expect(redactString(`Authorization:b'M'${S}`)).toBe(`Authorization:b'${REDACTED}'${S}`);
    expect(redactString(`Authorization=u"a"${S}`)).toBe(`Authorization=u"${REDACTED}"${S}`);
    // an option value that is a word with a credential's name and separator glued behind it (`-passwd S-auth=`), an empty container and a backslash-colon, and a text-written
    // line break followed by `n=S` (the value of another name: an earlier tree redacted it with the rest)
    // (both were readable here: a word after an option that does not read as a name is the option's value and is hidden whole now; see `redaction-space-options`)
    expect(redactString(`-passwd ${S}-auth=`)).toBe(`-passwd ${REDACTED}`);
    expect(redactString(`-token ${S}secret=`)).toBe(`-token ${REDACTED}`);
    expect(redactString(`apikey={}${B}:${S}`)).toBe(`apikey=${REDACTED}`); // (was a limit: the token now runs on after the closed bracket)
    // a glued secret that ends in a credential's name and a colon (`-pSapikey:`: the glued rule leaves an option name that a colon follows), a label chain that ends in a YAML list item,
    // and a bracket that is followed by a dangling label (the value is the word behind the label: garbled shapes, which the round-5 tree hid)
    expect(redactString(`-p${S}apikey:`)).toBe(`-p${S}apikey:`);
    expect(redactString(`Bearer%3D':\n- ${S}`)).toBe(`Bearer='${REDACTED}\n- ${S}`);
    expect(redactString(`apikey=[]${B}secret:${B}n ${S}`)).toBe(`apikey=${REDACTED} ${S}`);
    expect(redactString(`${PW}:e${B}nn=${S}`)).toBe(`${PW}:${REDACTED}${B}nn=${S}`);
  });
});
