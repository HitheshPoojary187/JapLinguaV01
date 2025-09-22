const path = require("path");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const _interopDefault = (m) => (m && m.default) ? m.default : m;
const Kuroshiro = _interopDefault(require("kuroshiro"));
const KuromojiAnalyzer = _interopDefault(require("kuroshiro-analyzer-kuromoji"));

const app = express();
app.use(cors());

const kuroshiro = new Kuroshiro();
(async () => {
  await kuroshiro.init(new KuromojiAnalyzer());
  console.log("✅ Kuroshiro initialized (kanji → kana/romaji ready)");
})();

app.get("/translate", async (req, res) => {
  const text = req.query.text;
  const inputType = req.query.inputType;
  if (!text) return res.status(400).json({ error: "No text provided" });

  let fromLang, toLang;
  // Determine translation direction based on inputType
  if (inputType === "japanese") {
    fromLang = "ja";
    toLang = "en";
  } else if (inputType === "romanji") {
    // Romanji input is converted to kana on frontend, so treat as Japanese
    fromLang = "ja";
    toLang = "en";
  } else if (inputType === "english") {
    fromLang = "en";
    toLang = "ja";
  } else {
    // fallback: auto-detect
    const isJapanese = /[ぁ-んァ-ン一-龯]/.test(text);
    fromLang = isJapanese ? "ja" : "en";
    toLang = isJapanese ? "en" : "ja";
  }

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(
      text
    )}`;
    console.log("[Server] Incoming:", { text, fromLang, toLang, url });
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      },
      timeout: 10000,
      validateStatus: (s) => s >= 200 && s < 500,
    });
    console.log("[Server] Upstream status:", response.status);
    if (response.status >= 400) {
      return res.status(502).json({ error: "Upstream translation error", status: response.status });
    }
    const data = response.data;
    console.log("[Server] Upstream body (truncated):", typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200));
    let translated = "";
    if (Array.isArray(data) && Array.isArray(data[0])) {
      translated = data[0].map((item) => (Array.isArray(item) ? item[0] : "")).join("");
    } else if (typeof data === "string") {
      translated = data;
    } else {
      return res.status(502).json({ error: "Unexpected upstream response" });
    }

    let romanized = null;
    if (inputType === "japanese" && fromLang === "ja") {
      // For Japanese input, romanize the original text
      romanized = await kuroshiro.convert(text, {
        to: "romaji",
        romajiSystem: "hepburn",
        mode: "spaced",
      });
    } else if (inputType === "english" && toLang === "ja") {
      // For English input, romanize the translated Japanese
      romanized = await kuroshiro.convert(translated, {
        to: "romaji",
        romajiSystem: "hepburn",
        mode: "spaced",
      });
    }
    // For Romanji input, do NOT return romanized, only English meaning

    const payload = {
      input: text,
      from: fromLang,
      to: toLang,
      translated,
      romanized,
    };
    console.log("[Server] Outgoing JSON:", payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Translation failed", details: err.message });
  }
});

// Serve static files (index.html) from project root
app.use(express.static(path.join(__dirname)));

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
