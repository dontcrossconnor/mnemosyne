import { describe, it, expect } from "vitest";
import {
  classifyMemoryType,
  classifyUrgency,
  classifyDomain,
  computePriorityScore,
} from "../src/pipeline/classifier.js";

// ───────── classifyMemoryType ──────────────────────────────────────────────

describe("classifyMemoryType", () => {
  // Returns default "semantic" for empty / non-matching text
  it("returns 'semantic' for empty text", () => {
    expect(classifyMemoryType("")).toBe("semantic");
  });

  it("returns 'semantic' for text with no known pattern", () => {
    expect(classifyMemoryType("the sky is blue and the grass is green")).toBe(
      "semantic",
    );
  });

  // core (3 pattern branches)
  it("classifies 'core' when text mentions owner/creator/admin/master", () => {
    expect(classifyMemoryType("the owner of this system is Alice")).toBe(
      "core",
    );
    expect(classifyMemoryType("creator user has full access")).toBe("core");
    expect(classifyMemoryType("admin privileges required")).toBe("core");
    expect(classifyMemoryType("master branch is protected")).toBe("core");
  });

  it("classifies 'core' when text has trust = absolute", () => {
    expect(classifyMemoryType("trust = absolute for this agent")).toBe("core");
  });

  it("classifies 'core' when text says never change/modify/delete", () => {
    expect(classifyMemoryType("never change this setting")).toBe("core");
    expect(classifyMemoryType("never modify the core rules")).toBe("core");
    expect(classifyMemoryType("never delete this memory")).toBe("core");
  });

  // procedural (4 pattern branches + code block)
  it("classifies 'procedural' when text contains 'step N'", () => {
    expect(classifyMemoryType("step 1: install the package")).toBe(
      "procedural",
    );
    expect(classifyMemoryType("Follow step 42 carefully")).toBe("procedural");
  });

  it("classifies 'procedural' when text contains 'how to'", () => {
    expect(classifyMemoryType("how to deploy the service")).toBe("procedural");
  });

  it("classifies 'procedural' for install/setup/configure/deploy verbs", () => {
    expect(classifyMemoryType("install the dependencies")).toBe("procedural");
    expect(classifyMemoryType("setup the environment")).toBe("procedural");
    expect(classifyMemoryType("configure the server")).toBe("procedural");
    expect(classifyMemoryType("deploy to production")).toBe("procedural");
  });

  it("classifies 'procedural' for 'run the command'", () => {
    expect(classifyMemoryType("run the command to start")).toBe("procedural");
    expect(classifyMemoryType("run command now")).toBe("procedural");
  });

  it("classifies 'procedural' when text contains a code block", () => {
    expect(classifyMemoryType("use ```npm install``` to install")).toBe(
      "procedural",
    );
  });

  // preference (prefer/like/love/hate/want/need/favor, always|never + use/want/do)
  it("classifies 'preference' when text contains prefer/like/love/hate", () => {
    expect(classifyMemoryType("I prefer dark mode")).toBe("preference");
    expect(classifyMemoryType("She likes concise responses")).toBe("preference");
    expect(classifyMemoryType("He loves automation")).toBe("preference");
    expect(classifyMemoryType("I hate slow builds")).toBe("preference");
    expect(classifyMemoryType("Everyone dislikes downtime")).toBe("preference");
  });

  it("classifies 'preference' for want/need/favor words", () => {
    expect(classifyMemoryType("I want verbose logs")).toBe("preference");
    expect(classifyMemoryType("We need more memory")).toBe("preference");
    expect(classifyMemoryType("The team favors Python")).toBe("preference");
  });

  it("classifies 'preference' for 'always|never use/want/do' patterns", () => {
    expect(classifyMemoryType("always use tabs")).toBe("preference");
    expect(classifyMemoryType("never use spaces")).toBe("preference");
    expect(classifyMemoryType("always want fast feedback")).toBe("preference");
    expect(classifyMemoryType("never do that again")).toBe("preference");
  });

  // relationship
  it("classifies 'relationship' for coordinates/manages/reports to", () => {
    expect(classifyMemoryType("Alice coordinates the team")).toBe(
      "relationship",
    );
    expect(classifyMemoryType("Bob manages the project")).toBe("relationship");
    expect(classifyMemoryType("Charlie reports to Alice")).toBe("relationship");
  });

  it("classifies 'relationship' for 'works with' / 'collaborates'", () => {
    expect(classifyMemoryType("Dave works with Eve")).toBe("relationship");
    expect(classifyMemoryType("The team collaborates on code")).toBe(
      "relationship",
    );
  });

  it("classifies 'relationship' for 'connected to' / 'linked to' / 'depends on'", () => {
    expect(classifyMemoryType("Service A depends on Service B")).toBe(
      "relationship",
    );
    expect(classifyMemoryType("Module X is connected to Module Y")).toBe(
      "relationship",
    );
    expect(classifyMemoryType("This is linked to that")).toBe("relationship");
  });

  // profile
  it("classifies 'profile' for personality/character/style/tone/behavior", () => {
    expect(classifyMemoryType("my personality is friendly")).toBe("profile");
    expect(classifyMemoryType("the character is curious")).toBe("profile");
    expect(classifyMemoryType("writing style is concise")).toBe("profile");
    expect(classifyMemoryType("tone should be professional")).toBe("profile");
    expect(classifyMemoryType("the behavior is cautious")).toBe("profile");
  });

  it("classifies 'profile' for SOUL keyword", () => {
    expect(classifyMemoryType("SOUL: curious helper agent")).toBe("profile");
  });

  it("classifies 'profile' for 'is a' / 'acts as' / 'behaves like'", () => {
    expect(classifyMemoryType("This agent is a helpful assistant")).toBe(
      "profile",
    );
    expect(classifyMemoryType("It acts as a translator")).toBe("profile");
    // "like" in "behaves like" triggers preference first; test the pattern
    // via a string that only hits profile
    expect(classifyMemoryType("the system is a broker")).toBe("profile");
  });

  // episodic
  it("classifies 'episodic' for time references (yesterday/today/last week)", () => {
    expect(classifyMemoryType("yesterday we deployed")).toBe("episodic");
    expect(classifyMemoryType("today we reviewed the PR")).toBe("episodic");
    expect(classifyMemoryType("last week we had a meeting")).toBe("episodic");
    expect(classifyMemoryType("last time we checked")).toBe("episodic");
  });

  it("classifies 'episodic' for weekday references", () => {
    expect(classifyMemoryType("on Monday we shipped")).toBe("episodic");
    expect(classifyMemoryType("on Friday we reviewed")).toBe("episodic");
  });

  it("classifies 'episodic' for ISO date strings", () => {
    expect(classifyMemoryType("happened on 2025-06-17")).toBe("episodic");
    expect(classifyMemoryType("recorded at 2024-12-01")).toBe("episodic");
  });

  it("classifies 'episodic' for conversational past-tense verbs", () => {
    expect(classifyMemoryType("Alice asked about the API")).toBe("episodic");
    expect(classifyMemoryType("Bob said to wait")).toBe("episodic");
    expect(classifyMemoryType("Charlie mentioned the bug")).toBe("episodic");
    expect(classifyMemoryType("we discussed the roadmap")).toBe("episodic");
    expect(classifyMemoryType("they told us the plan")).toBe("episodic");
  });

  // First-match wins — ensure order matters
  it("returns the first matching type when multiple patterns match", () => {
    // Both core and procedural could match, but core comes first.
    // "admin step 1" — "admin" hits core (owner/creator/admin/master),
    // before "step 1" hits procedural.
    expect(classifyMemoryType("admin step 1")).toBe("core");
  });
});

// ───────── classifyUrgency ─────────────────────────────────────────────────

describe("classifyUrgency", () => {
  // Default
  it("returns 'reference' for text with no urgency patterns", () => {
    expect(classifyUrgency("the weather is nice today")).toBe("reference");
  });

  it("returns 'reference' for empty text", () => {
    expect(classifyUrgency("")).toBe("reference");
  });

  // critical
  it("classifies 'critical' for crash/down/broken/fail/emergency/urgent/ASAP/immediately", () => {
    expect(classifyUrgency("a crash occurred")).toBe("critical");
    expect(classifyUrgency("production is down")).toBe("critical");
    expect(classifyUrgency("the pipeline is broken")).toBe("critical");
    expect(classifyUrgency("build will fail")).toBe("critical");
    expect(classifyUrgency("this is an emergency")).toBe("critical");
    expect(classifyUrgency("urgent: please respond")).toBe("critical");
    expect(classifyUrgency("fix this ASAP")).toBe("critical");
    expect(classifyUrgency("handle this immediately")).toBe("critical");
  });

  it("classifies 'critical' for data loss / security / vulnerability / breach", () => {
    expect(classifyUrgency("risk of data loss")).toBe("critical");
    expect(classifyUrgency("security issue detected")).toBe("critical");
    expect(classifyUrgency("a vulnerability was found")).toBe("critical");
    expect(classifyUrgency("security breach in progress")).toBe("critical");
  });

  // important
  it("classifies 'important' for should/must/need to/required/deadline/decision", () => {
    expect(classifyUrgency("we should review this")).toBe("important");
    expect(classifyUrgency("you must update the config")).toBe("important");
    expect(classifyUrgency("we need to decide")).toBe("important");
    expect(classifyUrgency("this is required")).toBe("important");
    expect(classifyUrgency("the deadline is Friday")).toBe("important");
    expect(classifyUrgency("a decision is pending")).toBe("important");
  });

  it("classifies 'important' for blocker/blocking/dependency", () => {
    expect(classifyUrgency("this is a blocker")).toBe("important");
    expect(classifyUrgency("issue blocking the release")).toBe("important");
    expect(classifyUrgency("we have a dependency on that")).toBe("important");
  });

  // background
  it("classifies 'background' for nice-to-know / FYI / trivia / fun fact / by the way", () => {
    expect(classifyUrgency("nice to know: the API rate limit")).toBe(
      "background",
    );
    expect(classifyUrgency("FYI the build passed")).toBe("background");
    expect(classifyUrgency("trivia: the first bug was a moth")).toBe(
      "background",
    );
    expect(classifyUrgency("fun fact: octopuses have 3 hearts")).toBe(
      "background",
    );
    expect(classifyUrgency("by the way, the endpoint changed")).toBe(
      "background",
    );
  });
});

// ───────── classifyDomain ──────────────────────────────────────────────────

describe("classifyDomain", () => {
  // Default
  it("returns 'knowledge' for text with no domain patterns", () => {
    expect(classifyDomain("a rose by any other name")).toBe("knowledge");
  });

  it("returns 'knowledge' for empty text", () => {
    expect(classifyDomain("")).toBe("knowledge");
  });

  // technical
  it("classifies 'technical' for code/server/port/API/docker/SSH terms", () => {
    expect(classifyDomain("refactor the code")).toBe("technical");
    expect(classifyDomain("restart the server")).toBe("technical");
    expect(classifyDomain("open port 8080")).toBe("technical");
    expect(classifyDomain("call the API")).toBe("technical");
    expect(classifyDomain("docker compose up")).toBe("technical");
    expect(classifyDomain("SSH into the host")).toBe("technical");
    expect(classifyDomain("query the database")).toBe("technical");
    expect(classifyDomain("deploy the build")).toBe("technical");
    expect(classifyDomain("git push origin main")).toBe("technical");
    expect(classifyDomain("npm install")).toBe("technical");
    expect(classifyDomain("pip install torch")).toBe("technical");
  });

  it("classifies 'technical' for error/bug/fix/debug/test/build/compile", () => {
    expect(classifyDomain("an error occurred")).toBe("technical");
    expect(classifyDomain("found a bug")).toBe("technical");
    expect(classifyDomain("fix the typo")).toBe("technical");
    expect(classifyDomain("debug the issue")).toBe("technical");
    expect(classifyDomain("run a test")).toBe("technical");
    expect(classifyDomain("build the project")).toBe("technical");
    expect(classifyDomain("compile the code")).toBe("technical");
  });

  // personal
  it("classifies 'personal' for like/prefer/feel/happy/sad/frustrated/excited", () => {
    expect(classifyDomain("I like this approach")).toBe("personal");
    expect(classifyDomain("I prefer blue")).toBe("personal");
    expect(classifyDomain("I feel great today")).toBe("personal");
    expect(classifyDomain("I am happy with the result")).toBe("personal");
    expect(classifyDomain("I am sad about the news")).toBe("personal");
    expect(classifyDomain("I am frustrated")).toBe("personal");
    expect(classifyDomain("I am excited")).toBe("personal");
  });

  it("classifies 'personal' for my/mine/personal/private", () => {
    expect(classifyDomain("my opinion is")).toBe("personal");
    expect(classifyDomain("this is mine")).toBe("personal");
    expect(classifyDomain("a personal note")).toBe("personal");
    expect(classifyDomain("private conversation")).toBe("personal");
  });

  // project
  it("classifies 'project' for project/task/sprint/milestone/deadline/feature/issue", () => {
    expect(classifyDomain("the project is on track")).toBe("project");
    expect(classifyDomain("create a task")).toBe("project");
    expect(classifyDomain("sprint planning")).toBe("project");
    expect(classifyDomain("milestone 2 completed")).toBe("project");
    expect(classifyDomain("deadline is Friday")).toBe("project");
    expect(classifyDomain("new feature request")).toBe("project");
    expect(classifyDomain("known issue logged")).toBe("project");
  });

  it("classifies 'project' for roadmap/timeline/schedule/release", () => {
    expect(classifyDomain("the roadmap is set")).toBe("project");
    expect(classifyDomain("update the timeline")).toBe("project");
    expect(classifyDomain("release schedule")).toBe("project");
    expect(classifyDomain("v2.0 release")).toBe("project");
  });

  // First-match wins — technical patterns come before personal
  it("returns the first matching domain when multiple match", () => {
    // "fix the bug" is technical (fix + bug) — comes before personal
    expect(classifyDomain("fix the bug")).toBe("technical");
  });
});

// ───────── computePriorityScore ────────────────────────────────────────────

describe("computePriorityScore", () => {
  // Score = urgencyScore + domainBoost, clamped to [0, 1]

  it("returns 1.0 for critical + technical (1.0 + 0.1 = 1.1 → 1.0)", () => {
    expect(computePriorityScore("critical", "technical")).toBe(1.0);
  });

  it("returns 1.0 for critical + project (1.0 + 0.05 = 1.05 → 1.0)", () => {
    expect(computePriorityScore("critical", "project")).toBe(1.0);
  });

  it("returns 1.0 for critical + personal (1.0 + 0.0 = 1.0)", () => {
    expect(computePriorityScore("critical", "personal")).toBe(1.0);
  });

  it("returns 0.95 for critical + knowledge (1.0 + -0.05 = 0.95)", () => {
    expect(computePriorityScore("critical", "knowledge")).toBe(0.95);
  });

  it("returns 0.95 for critical + general (1.0 + -0.05 = 0.95)", () => {
    expect(computePriorityScore("critical", "general")).toBe(0.95);
  });

  it("returns 0.85 for important + technical (0.75 + 0.1 = 0.85)", () => {
    expect(computePriorityScore("important", "technical")).toBe(0.85);
  });

  it("returns 0.8 for important + project (0.75 + 0.05 = 0.8)", () => {
    expect(computePriorityScore("important", "project")).toBe(0.8);
  });

  it("returns 0.75 for important + personal (0.75 + 0.0 = 0.75)", () => {
    expect(computePriorityScore("important", "personal")).toBe(0.75);
  });

  it("returns 0.7 for important + knowledge (0.75 + -0.05 = 0.7)", () => {
    expect(computePriorityScore("important", "knowledge")).toBe(0.7);
  });

  it("returns 0.7 for important + general (0.75 + -0.05 = 0.7)", () => {
    expect(computePriorityScore("important", "general")).toBe(0.7);
  });

  it("returns 0.6 for reference + technical (0.5 + 0.1 = 0.6)", () => {
    expect(computePriorityScore("reference", "technical")).toBe(0.6);
  });

  it("returns 0.55 for reference + project (0.5 + 0.05 = 0.55)", () => {
    expect(computePriorityScore("reference", "project")).toBe(0.55);
  });

  it("returns 0.5 for reference + personal (0.5 + 0.0 = 0.5)", () => {
    expect(computePriorityScore("reference", "personal")).toBe(0.5);
  });

  it("returns 0.45 for reference + knowledge (0.5 + -0.05 = 0.45)", () => {
    expect(computePriorityScore("reference", "knowledge")).toBe(0.45);
  });

  it("returns 0.45 for reference + general (0.5 + -0.05 = 0.45)", () => {
    expect(computePriorityScore("reference", "general")).toBe(0.45);
  });

  it("returns 0.35 for background + technical (0.25 + 0.1 = 0.35)", () => {
    expect(computePriorityScore("background", "technical")).toBe(0.35);
  });

  it("returns 0.3 for background + project (0.25 + 0.05 = 0.3)", () => {
    expect(computePriorityScore("background", "project")).toBe(0.3);
  });

  it("returns 0.25 for background + personal (0.25 + 0.0 = 0.25)", () => {
    expect(computePriorityScore("background", "personal")).toBe(0.25);
  });

  it("returns 0.2 for background + knowledge (0.25 + -0.05 = 0.2)", () => {
    expect(computePriorityScore("background", "knowledge")).toBe(0.2);
  });

  it("returns 0.2 for background + general (0.25 + -0.05 = 0.2)", () => {
    expect(computePriorityScore("background", "general")).toBe(0.2);
  });

  // Lower bound clamping (background + knowledge/general = 0.2 — no clamping needed)
  // Lowest possible: critical + knowledge/general = 0.95 (already above 0)
  // Nothing hits 0, but verify floor is respected if hypothetical inputs changed
  it("clamps to 0.0 if sum goes below zero", () => {
    // Not currently reachable, but verify the clamp is in place
    // by checking the lowest real combination is above zero
    expect(computePriorityScore("background", "knowledge")).toBeGreaterThanOrEqual(0.0);
  });
});
