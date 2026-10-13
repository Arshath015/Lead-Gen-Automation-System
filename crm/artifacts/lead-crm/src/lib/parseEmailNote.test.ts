import { describe, it, expect } from "vitest";
import { parseEmailNote } from "./parseEmailNote";

describe("parseEmailNote", () => {
  it("parses a fully-formed email note", () => {
    const content = "**To:** alice@example.com\n**Subject:** Hello there\n\nThis is the body.";
    const result = parseEmailNote(content);
    expect(result).toEqual({
      to: "alice@example.com",
      subject: "Hello there",
      body: "This is the body.",
    });
  });

  it("returns empty body string when the body section is empty", () => {
    const content = "**To:** alice@example.com\n**Subject:** Hello there\n\n";
    const result = parseEmailNote(content);
    expect(result).not.toBeNull();
    expect(result!.to).toBe("alice@example.com");
    expect(result!.subject).toBe("Hello there");
    expect(result!.body).toBe("");
  });

  it("returns empty body string when there is no double-newline separator", () => {
    const content = "**To:** alice@example.com\n**Subject:** Hello there";
    const result = parseEmailNote(content);
    expect(result).not.toBeNull();
    expect(result!.body).toBe("");
  });

  it("preserves multi-line body", () => {
    const content = "**To:** bob@example.com\n**Subject:** Multi-line\n\nLine one\nLine two\nLine three";
    const result = parseEmailNote(content);
    expect(result!.body).toBe("Line one\nLine two\nLine three");
  });

  it("returns null for plain-text legacy notes with no structured headers", () => {
    const content = "Had a great call with the client today. Following up next week.";
    expect(parseEmailNote(content)).toBeNull();
  });

  it("returns null for manually-typed email-type notes without headers", () => {
    const content = "email to john about proposal";
    expect(parseEmailNote(content)).toBeNull();
  });

  it("handles a note that only has the To header (missing Subject)", () => {
    const result = parseEmailNote("**To:** carol@example.com\n\nSome body");
    expect(result).not.toBeNull();
    expect(result!.to).toBe("carol@example.com");
    expect(result!.subject).toBe("");
    expect(result!.body).toBe("Some body");
  });

  it("handles a note that only has the Subject header (missing To)", () => {
    const result = parseEmailNote("**Subject:** Just a subject\n\nBody here");
    expect(result).not.toBeNull();
    expect(result!.to).toBe("");
    expect(result!.subject).toBe("Just a subject");
    expect(result!.body).toBe("Body here");
  });
});
