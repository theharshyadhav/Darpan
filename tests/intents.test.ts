import { describe, expect, it } from "vitest";
import { isRetry, normalise, parseDuration, parseIntents, productNameFrom, tokenize, type Intent, type ParseContext } from "@/client/intents";
import { lintUtterance } from "@/lib/persona/lint";

const MORNING = new Date(2026, 9, 18, 8, 30);
const NIGHT = new Date(2026, 9, 18, 21, 15);
const idle: ParseContext = { ritualActive: false, now: MORNING };
const inRitual: ParseContext = { ritualActive: true, now: MORNING };

const parse = (text: string, ctx: ParseContext = idle) => parseIntents(text, ctx);
const types = (text: string, ctx: ParseContext = idle) => (parse(text, ctx) ?? []).map((i) => i.type);
const first = (text: string, ctx: ParseContext = idle): Intent | undefined => parse(text, ctx)?.[0];

describe("normalise and tokenize", () => {
  it("drops punctuation, case, danda and Devanagari nukta dots", () => {
    expect(normalise("Scan my skin, please!")).toBe("scan my skin please");
    expect(normalise("ज़रूर। फ़ेस वॉश")).toBe("जरूर फेस वॉश");
    expect(normalise("२ मिनट")).toBe("2 मिनट");
    expect(tokenize("   ")).toEqual([]);
  });
  it("keeps apostrophes inside words", () => {
    expect(tokenize("I’m applying it")).toEqual(["i'm", "applying", "it"]);
  });
});

describe("parseDuration", () => {
  const d = (s: string) => parseDuration(tokenize(s));
  it("reads digits, words, fractions and Hindi", () => {
    expect(d("90 seconds")).toBe(90);
    expect(d("two minutes")).toBe(120);
    expect(d("a minute")).toBe(60);
    expect(d("half a minute")).toBe(30);
    expect(d("one and a half minutes")).toBe(90);
    expect(d("forty five seconds")).toBe(45);
    expect(d("dedh minute")).toBe(90);
    expect(d("do minute")).toBe(120);
    expect(d("दो मिनट")).toBe(120);
    expect(d("पाँच मिनट")).toBe(300);
    expect(d("३० सेकंड")).toBe(30);
    expect(d("aadha minute")).toBe(30);
  });
  it("says nothing when there is no duration", () => {
    expect(d("start a timer")).toBeNull();
    expect(d("minute")).toBeNull();
    expect(d("zero minutes")).toBeNull();
  });
});

describe("rails: starting things", () => {
  it.each([
    ["scan my skin", "start_scan"],
    ["Darpan, please scan my skin", "start_scan"],
    ["hey darpan analyze my face", "start_scan"],
    ["check my skin", "start_scan"],
    ["can you measure my skin", "start_scan"],
    ["meri skin scan karo", "start_scan"],
    ["मेरी त्वचा स्कैन करो", "start_scan"],
    ["mera chehra dekho", "start_scan"],
    ["scan", "start_scan"],
    ["start my morning ritual", "start_ritual"],
    ["begin evening routine", "start_ritual"],
    ["subah ki routine shuru karo", "start_ritual"],
    ["सुबह की दिनचर्या शुरू करो", "start_ritual"],
    ["morning ritual", "start_ritual"],
    ["let's begin", "start_ritual"],
    ["second look", "verify"],
    ["scan again", "verify"],
    ["dobara scan karo", "verify"],
    ["did it work", "verify"],
    ["show my results", "show_report"],
    ["what did you find", "show_report"],
    ["show my royal ledger", "show_ledger"],
    ["is it working", "show_ledger"],
    ["bahi kholo", "show_ledger"],
    ["what is this bottle", "look_at_product"],
    ["scan this bottle", "look_at_product"],
    ["read this label", "look_at_product"],
    ["yeh kya hai", "look_at_product"],
    ["open settings", "settings"],
    ["repeat that", "repeat"],
    ["say that again", "repeat"],
    ["phir se bolo", "repeat"],
  ])("%s -> %s", (text, type) => {
    expect(types(text)).toEqual([type]);
  });

  it("chooses morning or evening from the words, then the clock", () => {
    expect(first("start my ritual", { ritualActive: false, now: MORNING })).toEqual({ type: "start_ritual", period: "am" });
    expect(first("start my ritual", { ritualActive: false, now: NIGHT })).toEqual({ type: "start_ritual", period: "pm" });
    expect(first("start my evening ritual", { ritualActive: false, now: MORNING })).toEqual({ type: "start_ritual", period: "pm" });
    expect(first("raat ki routine shuru karo", { ritualActive: false, now: MORNING })).toEqual({ type: "start_ritual", period: "pm" });
    expect(first("start my morning routine", { ritualActive: false, now: NIGHT })).toEqual({ type: "start_ritual", period: "am" });
  });

  it("does not mistake bottle talk for a skin scan, or skin talk for a bottle", () => {
    expect(types("scan my face")).toEqual(["start_scan"]);
    expect(types("what is this product")).toEqual(["look_at_product"]);
    expect(types("which product should I use")).not.toContain("look_at_product");
  });
});

describe("rails: ritual flow", () => {
  it("logs what the person is applying", () => {
    expect(first("I'm applying my vitamin C serum")).toMatchObject({ type: "log_product", name: "Vitamin C serum", category: "vitamin_c" });
    expect(first("now using the niacinamide serum")).toMatchObject({ type: "log_product", category: "niacinamide" });
    expect(first("putting on sunscreen")).toMatchObject({ type: "log_product", name: "Sunscreen", category: "sunscreen" });
    expect(first("ab moisturizer laga rahi hoon")).toMatchObject({ type: "log_product", name: "Moisturizer", category: "moisturizer" });
    expect(first("main apna vitamin c serum laga raha hoon")).toMatchObject({ type: "log_product", category: "vitamin_c" });
    expect(first("मैं सीरम लगा रही हूँ")).toMatchObject({ type: "log_product", category: "serum" });
  });

  it("treats a bare product as logging only while a ritual is running", () => {
    expect(first("cleanser", inRitual)).toMatchObject({ type: "log_product", category: "cleanser" });
    expect(first("The Ordinary niacinamide", inRitual)).toMatchObject({ type: "log_product", name: "The Ordinary niacinamide", category: "niacinamide" });
    expect(parse("cleanser", idle)).toBeNull();
  });

  it("keeps a brand it cannot classify, so the mirror can ask what it is", () => {
    expect(first("I'm applying Effaclar Duo")).toEqual({ type: "log_product", name: "Effaclar Duo" });
  });

  it("does not log a question as a product", () => {
    expect(parse("can I use vitamin C with retinol?", inRitual)).toBeNull();
    expect(parse("should I put sunscreen on first", inRitual)).toBeNull();
    expect(parse("what does niacinamide do", inRitual)).toBeNull();
  });

  it("understands skip and finish", () => {
    expect(types("skip", inRitual)).toEqual(["skip_step"]);
    expect(types("skip this one", inRitual)).toEqual(["skip_step"]);
    expect(types("chhodo", inRitual)).toEqual(["skip_step"]);
    expect(types("next", inRitual)).toEqual(["skip_step"]);
    expect(types("I'm done", inRitual)).toEqual(["finish_ritual"]);
    expect(types("ho gaya", inRitual)).toEqual(["finish_ritual"]);
    expect(types("हो गया", inRitual)).toEqual(["finish_ritual"]);
    expect(types("finish my routine", inRitual)).toEqual(["finish_ritual"]);
    expect(types("that's all", inRitual)).toEqual(["finish_ritual"]);
  });

  it("bas alone means quiet, bas ho gaya means finished", () => {
    expect(types("bas")).toEqual(["hush"]);
    expect(types("bas ho gaya", inRitual)).toEqual(["finish_ritual"]);
  });
});

describe("rails: timers", () => {
  it("starts and stops them", () => {
    expect(first("set a timer for two minutes")).toEqual({ type: "start_timer", seconds: 120 });
    expect(first("timer 90 seconds")).toEqual({ type: "start_timer", seconds: 90 });
    expect(first("2 minute ka timer lagao")).toEqual({ type: "start_timer", seconds: 120 });
    expect(first("दो मिनट का टाइमर")).toEqual({ type: "start_timer", seconds: 120 });
    expect(first("start a timer")).toEqual({ type: "start_timer", seconds: 60 });
    expect(first("stop the timer")).toEqual({ type: "stop_timer" });
    expect(first("timer band karo")).toEqual({ type: "stop_timer" });
  });
  it("keeps durations in a sensible range", () => {
    expect(first("timer for 1 second")).toEqual({ type: "start_timer", seconds: 5 });
    expect(first("timer for 90 minutes")).toEqual({ type: "start_timer", seconds: 1800 });
  });
  it("understands a bare duration phrase", () => {
    expect(first("massage for one minute")).toEqual({ type: "start_timer", seconds: 60 });
  });
});

describe("rails: language and titles", () => {
  it.each([
    ["speak hindi", "hi"],
    ["hindi mein baat karo", "hi"],
    ["हिंदी में बोलो", "hi"],
    ["Hindi", "hi"],
    ["speak english please", "en"],
    ["english", "en"],
    ["talk in hinglish", "hinglish"],
    ["hinglish", "hinglish"],
  ])("%s -> %s", (text, language) => {
    expect(first(text)).toEqual({ type: "set_language", language });
  });

  it("learns a title, and refuses unsafe ones", () => {
    expect(first("call me Maharani")).toEqual({ type: "set_title", title: "Maharani" });
    expect(first("please call me your majesty")).toEqual({ type: "set_title", title: "Your majesty" });
    expect(first("mujhe Rani kaho")).toEqual({ type: "set_title", title: "Rani" });
    expect(first("मुझे महारानी कहो")).toEqual({ type: "set_title", title: "महारानी" });
    expect(first("call me the cure for acne")).not.toMatchObject({ type: "set_title" });
    const t = first("call me the Queen of Everything and More Than That") as { title?: string };
    if (t?.title) expect(t.title.length).toBeLessThanOrEqual(24);
  });
});

describe("rails: looks, tracking, erasing", () => {
  it("opens the look studio, with or without a named look", () => {
    expect(first("try a look")).toEqual({ type: "try_look", look: undefined });
    expect(first("show me some makeup looks")).toMatchObject({ type: "try_look" });
    expect(first("try the rani rose look")).toEqual({ type: "try_look", look: "rani_rose" });
    expect(first("show me midnight kohl")).toEqual({ type: "try_look", look: "midnight_kohl" });
    expect(first("peacock makeup")).toEqual({ type: "try_look", look: "peacock_pop" });
    expect(first("natural look")).toEqual({ type: "try_look", look: "barely_there" });
    expect(first("kajal look dikhao")).toEqual({ type: "try_look", look: "midnight_kohl" });
    expect(first("मोर वाला लुक दिखाओ")).toEqual({ type: "try_look", look: "peacock_pop" });
  });
  it("does not treat skincare words as looks", () => {
    expect(parse("I'm applying rose water toner")).toMatchObject([{ type: "log_product", category: "toner" }]);
    expect(types("marigold extract serum", inRitual)).not.toContain("try_look");
    expect(types("everyday moisturizer", inRitual)).toEqual(["log_product"]);
    expect(types("try again")).not.toContain("try_look");
  });
  it("tracks a new product", () => {
    expect(first("I just started using retinol")).toEqual({ type: "track_product", name: "Retinol", category: "retinoid" });
    expect(first("I bought a new niacinamide serum")).toMatchObject({ type: "track_product", category: "niacinamide" });
    expect(first("track my vitamin c serum")).toMatchObject({ type: "track_product", category: "vitamin_c" });
    expect(first("start tracking Cosrx Snail Mucin")).toEqual({ type: "track_product", name: "Cosrx Snail Mucin", category: undefined });
    expect(first("maine naya retinol shuru kiya")).toMatchObject({ type: "track_product", category: "retinoid" });
  });
  it("asks to erase only for clear requests", () => {
    expect(types("forget me")).toEqual(["forget_me"]);
    expect(types("delete my data")).toEqual(["forget_me"]);
    expect(types("mera data mita do")).toEqual(["forget_me"]);
    expect(types("मुझे भूल जाओ")).toEqual(["forget_me"]);
    expect(types("clear all timers")).not.toContain("forget_me");
    expect(types("remove my makeup")).not.toContain("forget_me");
  });
});

describe("rails: replies, small talk, quiet", () => {
  it.each([
    ["yes", "yes"],
    ["yes please", "yes"],
    ["haan ji", "yes"],
    ["ji haan", "yes"],
    ["हाँ", "yes"],
    ["theek hai", "yes"],
    ["go ahead", "yes"],
    ["sure", "yes"],
    ["no", "no"],
    ["no thanks", "no"],
    ["not now", "no"],
    ["nahi", "no"],
    ["नहीं", "no"],
    ["rehne do", "no"],
    ["never mind", "no"],
  ])("%s -> %s", (text, type) => {
    expect(types(text)).toEqual([type]);
  });
  it("answers what kind of product it is", () => {
    expect(first("it's a serum", { ritualActive: true, pending: "ask_category" })).toEqual({ type: "category", category: "serum" });
    expect(first("moisturizer", { ritualActive: true, pending: "ask_category" })).toEqual({ type: "category", category: "moisturizer" });
  });
  it("greets and thanks", () => {
    expect(types("hello")).toEqual(["greet"]);
    expect(types("namaste")).toEqual(["greet"]);
    expect(types("good morning")).toEqual(["greet"]);
    expect(types("hello darpan")).toEqual(["greet"]);
    expect(types("thank you")).toEqual(["thanks"]);
    expect(types("shukriya")).toEqual(["thanks"]);
  });
  it("hushes", () => {
    expect(types("stop")).toEqual(["hush"]);
    expect(types("be quiet")).toEqual(["hush"]);
    expect(types("chup")).toEqual(["hush"]);
    expect(types("stop the timer")).toEqual(["stop_timer"]);
  });
});

describe("rails: more than one request", () => {
  it("splits clear command lists", () => {
    expect(types("start my morning ritual and set a timer for one minute")).toEqual(["start_ritual", "start_timer"]);
    expect(types("scan my skin and then show my report")).toEqual(["start_scan", "show_report"]);
    expect(types("routine shuru karo aur cleanser laga rahi hoon")).toEqual(["start_ritual", "log_product"]);
  });
  it("does not split a list of products", () => {
    const out = parse("I'm applying retinol and vitamin C", idle) ?? [];
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "log_product" });
  });
  it("does not split what it cannot fully understand", () => {
    expect(parse("tell me about retinol and blah blah")).toBeNull();
  });
});

describe("rails: leaving things to the language model", () => {
  it.each([
    "",
    "   ",
    "what's the weather like",
    "can I use vitamin C and retinol together",
    "why does my skin feel tight in winter",
    "tell me a joke",
    "blah",
  ])("%j is not understood", (text) => {
    expect(parse(text, idle)).toBeNull();
  });
});

describe("productNameFrom", () => {
  it("removes scaffolding in three languages and keeps brands", () => {
    expect(productNameFrom("I'm now applying my vitamin c serum")).toBe("Vitamin c serum");
    expect(productNameFrom("ab sunscreen laga rahi hoon")).toBe("Sunscreen");
    expect(productNameFrom("मैं सनस्क्रीन लगा रही हूँ")).toBe("सनस्क्रीन");
    expect(productNameFrom("the CeraVe foaming cleanser")).toBe("CeraVe foaming cleanser");
    expect(productNameFrom("")).toBe("");
  });
  it("is length-limited", () => {
    expect(productNameFrom("x".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("isRetry", () => {
  it("spots a retry request", () => {
    for (const t of ["try again", "retry", "once more", "dobara", "फिर से", "again please"]) expect(isRetry(t)).toBe(true);
    expect(isRetry("scan my skin")).toBe(false);
    expect(isRetry("try the peacock look again please now")).toBe(false);
  });
});

describe("safety of what the rails hand on", () => {
  it("never produces a title that fails the claim linter", () => {
    for (const text of ["call me the miracle", "call me flawless", "call me doctor cure"]) {
      const out = parse(text);
      const title = out?.find((i) => i.type === "set_title") as { title: string } | undefined;
      if (title) expect(lintUtterance(title.title).ok).toBe(true);
    }
  });
});
