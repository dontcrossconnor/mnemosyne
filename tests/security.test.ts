import { describe, it, expect } from "vitest";
import { classifyMemory } from "../src/core/security.js";

describe("classifyMemory", () => {
  // ---------------------------------------------------------------------------
  // SECRET patterns – each of the 12 patterns tested individually
  // ---------------------------------------------------------------------------
  describe("SECRET classification", () => {
    it.each([
      { label: "/password/i", content: "my password is hunter2" },
      { label: "/passwd/i", content: "passwd=abc123" },
      { label: "/\\bpw:/i", content: "pw:supersecret" },
      { label: "/\\bsecret\\b/i", content: "this is a secret note" },
      { label: "/api.?key/i (dot)", content: "api.key=sk-1234" },
      { label: "/api.?key/i (underscore)", content: "api_key=sk-1234" },
      { label: "/api.?key/i (hyphen)", content: "api-key=sk-1234" },
      { label: "/api.?key/i (adjacent)", content: "apikey=12345" },
      { label: "/ssh.?key/i (dot)", content: "ssh.key is stored here" },
      { label: "/ssh.?key/i (underscore)", content: "ssh_key contents" },
      { label: "/ssh.?key/i (adjacent)", content: "sshkey contents" },
      { label: "/id_rsa/i", content: "id_rsa private key material" },
      { label: "/private.?key/i (dot)", content: "private.key data" },
      { label: "/private.?key/i (adjacent)", content: "privatekey data" },
      { label: "/\\btoken\\b/i", content: "my token is ghp_x" },
      { label: "16-digit credit card (grouped)", content: "4111 1111 1111 1111" },
      { label: "16-digit credit card (dash)", content: "4111-1111-1111-1111" },
      { label: "16-digit credit card (dot)", content: "4111.1111.1111.1111" },
      { label: "16 consecutive digits", content: "4111111111111111" },
      { label: "SSN pattern", content: "123-45-6789" },
    ])("returns 'secret' for '$label'", ({ content }) => {
      expect(classifyMemory(content)).toBe("secret");
    });
  });

  // ---------------------------------------------------------------------------
  // SECRET edge cases – near-misses that should NOT classify as secret
  // ---------------------------------------------------------------------------
  describe("SECRET near-misses (should NOT match)", () => {
    it("11-digit number does not match credit card patterns", () => {
      expect(classifyMemory("12345678901")).toBe("public");
    });

    it("15-digit card-like number does not match", () => {
      // 15-digit number – not 16 digits, not SSN
      expect(classifyMemory("123456789012345")).toBe("public");
    });

    it("17-digit number does not match", () => {
      expect(classifyMemory("12345678901234567")).toBe("public");
    });

    it("malformed SSN (wrong spacing)", () => {
      // Hyphen groups different from ##-###-#### → fails 3-2-4 pattern
      expect(classifyMemory("12-345-6789")).toBe("public");
    });

    it("'tokenized' is not standalone 'token'", () => {
      // \btoken\b must match word boundary – "tokenized" starts with token
      // but has no trailing boundary because 'i' follows
      expect(classifyMemory("tokenized")).toBe("public");
    });

    it("'secretly' is not standalone 'secret'", () => {
      expect(classifyMemory("secretly")).toBe("public");
    });

    it("'passwords' still matches /password/i (contains substring)", () => {
      // /password/i matches any substring so "passwords" contains "password"
      expect(classifyMemory("managing passwords")).toBe("secret");
    });

    it("'passwd' as part of a larger word (handling /passwd/i)", () => {
      // /passwd/i is a substring match, so "mypasswd" still hits
      expect(classifyMemory("mypasswd")).toBe("secret");
    });
  });

  // ---------------------------------------------------------------------------
  // PRIVATE classification (soul / lesson / error types with agentId)
  // ---------------------------------------------------------------------------
  describe("PRIVATE classification", () => {
    it.each(["soul", "lesson", "error"])(
      "returns 'private' for type='%s' with agentId",
      (type) => {
        expect(
          classifyMemory("some content", { agentId: "agent-1", type }),
        ).toBe("private");
      },
    );
  });

  describe("PRIVATE boundary conditions", () => {
    it("returns 'public' when type is PRIVATE type but agentId is missing", () => {
      expect(classifyMemory("content", { type: "soul" })).toBe("public");
    });

    it("returns 'public' when agentId is present but type is missing", () => {
      expect(classifyMemory("content", { agentId: "agent-1" })).toBe("public");
    });

    it("returns 'public' when context is empty", () => {
      expect(classifyMemory("content", {})).toBe("public");
    });

    it("returns 'public' when context is undefined (default param)", () => {
      expect(classifyMemory("content")).toBe("public");
    });

    it("returns 'public' for non-PRIVATE type with agentId", () => {
      expect(
        classifyMemory("content", { agentId: "agent-1", type: "episodic" }),
      ).toBe("public");
    });

    it("returns 'public' for unregistered type with agentId", () => {
      expect(
        classifyMemory("content", { agentId: "agent-1", type: "custom" }),
      ).toBe("public");
    });
  });

  // ---------------------------------------------------------------------------
  // SECRET takes priority over PRIVATE
  // ---------------------------------------------------------------------------
  describe("SECRET overrides PRIVATE", () => {
    it("secret content returns 'secret' even when PRIVATE type + agentId", () => {
      expect(
        classifyMemory("my api_key is sk-1234", {
          agentId: "agent-1",
          type: "soul",
        }),
      ).toBe("secret");
    });

    it("SSN in content returns 'secret' even with lesson type", () => {
      expect(
        classifyMemory("SSN: 123-45-6789", {
          agentId: "agent-1",
          type: "lesson",
        }),
      ).toBe("secret");
    });
  });

  // ---------------------------------------------------------------------------
  // PUBLIC fallback – no secret patterns, no PRIVATE type+agentId
  // ---------------------------------------------------------------------------
  describe("PUBLIC fallback", () => {
    it("plain innocuous text returns 'public'", () => {
      expect(classifyMemory("The weather is nice today.")).toBe("public");
    });

    it("empty string returns 'public'", () => {
      expect(classifyMemory("")).toBe("public");
    });

    it("string with only whitespace returns 'public'", () => {
      expect(classifyMemory("   \n\t  ")).toBe("public");
    });

    it("code snippet without secrets returns 'public'", () => {
      expect(classifyMemory("const x = 42;")).toBe("public");
    });

    it("URL without secrets returns 'public'", () => {
      expect(classifyMemory("https://example.com/memory")).toBe("public");
    });
  });

  // ---------------------------------------------------------------------------
  // Case insensitivity
  // ---------------------------------------------------------------------------
  describe("case insensitivity", () => {
    it.each([
      ["PASSWORD", "all-caps password"],
      ["Password", "Capitalised Password"],
      ["SECRET", "all-caps SECRET"],
      ["Api_Key", "mixed-case Api_Key"],
      ["SSH-KEY", "all-caps SSH-KEY"],
      ["TOKEN", "standalone TOKEN"],
    ])("'%s' triggers SECRET regardless of case", (content) => {
      expect(classifyMemory(content)).toBe("secret");
    });
  });

  // ---------------------------------------------------------------------------
  // Numeric / card-like pattern edge cases
  // ---------------------------------------------------------------------------
  describe("numeric pattern edge cases", () => {
    it("four groups of four digits with varying separators", () => {
      expect(classifyMemory("1111 2222 3333 4444")).toBe("secret");
      expect(classifyMemory("1111-2222-3333-4444")).toBe("secret");
      expect(classifyMemory("1111.2222.3333.4444")).toBe("secret");
    });

    it("three groups of four digits does NOT match (12 digits total)", () => {
      // 12-digit number shouldn't match the 16-digit card regex
      expect(classifyMemory("1111 2222 3333")).toBe("public");
    });

    it("SSN-like with extra characters", () => {
      // "xxx-xxx-xxxx" – wrong digit count
      expect(classifyMemory("xxx-xx-xxxx")).toBe("public");
    });
  });

  // ---------------------------------------------------------------------------
  // Context object edge cases
  // ---------------------------------------------------------------------------
  describe("context argument edge cases", () => {
    it("agentId as empty string", () => {
      expect(
        classifyMemory("content", { agentId: "", type: "soul" }),
      ).toBe("public");
    });

    it("type as empty string", () => {
      expect(
        classifyMemory("content", { agentId: "agent-1", type: "" }),
      ).toBe("public");
    });

    it("extra unknown properties on context are ignored", () => {
      expect(
        classifyMemory("content", {
          agentId: "agent-1",
          type: "lesson",
          extra: true,
        } as any),
      ).toBe("private");
    });
  });
});
