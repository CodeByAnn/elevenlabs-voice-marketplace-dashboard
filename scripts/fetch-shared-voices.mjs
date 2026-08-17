#!/usr/bin/env node

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_URL = "https://api.elevenlabs.io/v1/shared-voices";
const PAGE_SIZE = Number(process.env.ELEVENLABS_API_KEY ? 100 : process.env.ELEVENLABS_PAGE_SIZE || 3);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_DIR = path.join(ROOT, "data", "snapshots");
const snapshotDate = new Date().toISOString().slice(0, 10);

const fields = [
  "snapshot_date",
  "voice_id",
  "public_owner_id",
  "name",
  "language",
  "locale",
  "accent",
  "gender",
  "age",
  "descriptive",
  "use_case",
  "category",
  "usage_character_count_1y",
  "usage_character_count_7d",
  "cloned_by_count",
  "featured",
  "rate",
  "preview_url",
  "description",
];

function cleanText(value) {
  if (value === null || value === undefined || value === "") return "Unknown";
  return String(value).trim() || "Unknown";
}

function cleanNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeVoice(voice) {
  return {
    snapshot_date: snapshotDate,
    voice_id: cleanText(voice.voice_id),
    public_owner_id: cleanText(voice.public_owner_id),
    name: cleanText(voice.name),
    language: cleanText(voice.language),
    locale: cleanText(voice.locale),
    accent: cleanText(voice.accent).toLowerCase(),
    gender: cleanText(voice.gender).toLowerCase(),
    age: cleanText(voice.age).toLowerCase(),
    descriptive: cleanText(voice.descriptive).toLowerCase(),
    use_case: cleanText(voice.use_case).toLowerCase(),
    category: cleanText(voice.category).toLowerCase(),
    usage_character_count_1y: cleanNumber(voice.usage_character_count_1y),
    usage_character_count_7d: cleanNumber(voice.usage_character_count_7d),
    cloned_by_count: cleanNumber(voice.cloned_by_count),
    featured: Boolean(voice.featured),
    rate: cleanNumber(voice.rate),
    preview_url: cleanText(voice.preview_url),
    description: cleanText(voice.description),
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  return [
    fields.join(","),
    ...rows.map((row) => fields.map((field) => csvEscape(row[field])).join(",")),
  ].join("\n");
}

async function fetchSharedVoices(params = {}, attempt = 1) {
  const url = new URL(API_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      ...(process.env.ELEVENLABS_API_KEY ? { "xi-api-key": process.env.ELEVENLABS_API_KEY } : {}),
    },
  });

  if (!response.ok) {
    if (attempt < 4 && [408, 429, 500, 502, 503, 504].includes(response.status)) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt ** 2));
      return fetchSharedVoices(params, attempt + 1);
    }
    const body = await response.text();
    throw new Error(`ElevenLabs API returned ${response.status}: ${body.slice(0, 300)}`);
  }

  return response.json();
}

async function fetchPage(page) {
  return fetchSharedVoices({ page_size: PAGE_SIZE, page });
}

function publicDiscoveryQueries() {
  const sorts = ["usage_character_count_1y", "trending", "cloned_by_count", "created_date"];
  const categories = ["professional", "high_quality", "famous"];
  const genders = ["female", "male"];
  const ages = ["young", "middle_aged", "old"];
  const languages = [
    "en", "es", "fr", "de", "pt", "it", "pl", "nl", "hi", "ja", "ko", "zh", "ar", "ru", "tr",
    "sv", "uk", "id", "vi",
  ];
  const accents = [
    "american", "british", "australian", "indian", "canadian", "irish", "scottish", "african",
    "neutral", "peninsular", "latin_american", "mexican", "french", "german", "italian",
  ];
  const useCases = [
    "social_media", "conversational", "audiobook", "characters_animation", "narration",
    "news", "meditation", "education", "advertisement", "podcast",
  ];
  const descriptives = [
    "calm", "confident", "deep", "crisp", "warm", "mature", "professional", "expressive",
    "excited", "raspy", "soft",
  ];

  const queries = [{ page_size: 3 }];
  for (const sort of sorts) queries.push({ page_size: 3, sort });
  for (const sort of sorts) {
    for (const category of categories) queries.push({ page_size: 3, sort, category });
    for (const gender of genders) queries.push({ page_size: 3, sort, gender });
    for (const age of ages) queries.push({ page_size: 3, sort, age });
    for (const language of languages) queries.push({ page_size: 3, sort, language });
    for (const accent of accents) queries.push({ page_size: 3, sort, accent });
    for (const use_case of useCases) queries.push({ page_size: 3, sort, use_cases: use_case });
    for (const descriptive of descriptives) queries.push({ page_size: 3, sort, descriptives: descriptive });
  }
  return queries;
}

async function fetchPublicDiscoverySample() {
  const all = [];
  let completed = 0;
  let skipped = 0;

  for (const query of publicDiscoveryQueries()) {
    try {
      const payload = await fetchSharedVoices(query);
      const voices = Array.isArray(payload.voices) ? payload.voices : [];
      all.push(...voices);
      completed += 1;
    } catch (error) {
      skipped += 1;
      process.stdout.write(`Skipped public query ${JSON.stringify(query)} (${error.message.slice(0, 80)})\n`);
    }
  }

  return { rows: all, pages: completed, skipped, mode: "public_discovery_sample" };
}

async function main() {
  await mkdir(SNAPSHOT_DIR, { recursive: true });

  const all = [];
  let page = 0;
  let hasMore = true;
  let fetchedPages = 0;
  let skippedQueries = 0;
  let mode = process.env.ELEVENLABS_API_KEY ? "authenticated_full" : "anonymous_public";

  try {
    while (hasMore) {
      const payload = await fetchPage(page);
      const voices = Array.isArray(payload.voices) ? payload.voices : [];
      all.push(...voices);
      hasMore = Boolean(payload.has_more) && voices.length > 0;
      process.stdout.write(`Fetched page ${page} (${voices.length} voices)\n`);
      page += 1;
      fetchedPages = page;
    }
  } catch (error) {
    if (process.env.ELEVENLABS_API_KEY || page > 1) throw error;
    process.stdout.write("Anonymous API access does not permit full pagination. Switching to public discovery sampling.\n");
    const sample = await fetchPublicDiscoverySample();
    all.push(...sample.rows);
    fetchedPages = sample.pages;
    skippedQueries = sample.skipped;
    mode = sample.mode;
  }

  const deduped = Array.from(
    new Map(all.map((voice) => [voice.voice_id, normalizeVoice(voice)])).values(),
  ).filter((voice) => voice.voice_id !== "Unknown");

  deduped.sort((a, b) => b.usage_character_count_1y - a.usage_character_count_1y);

  const jsonPath = path.join(SNAPSHOT_DIR, `${snapshotDate}.json`);
  const csvPath = path.join(SNAPSHOT_DIR, `${snapshotDate}.csv`);
  const latestJsonPath = path.join(ROOT, "data", "latest.json");
  const latestCsvPath = path.join(ROOT, "data", "latest.csv");
  const metaPath = path.join(ROOT, "data", "snapshot-meta.json");

  const meta = {
    snapshot_date: snapshotDate,
    source: API_URL,
    page_size: PAGE_SIZE,
    mode,
    fetched_pages: fetchedPages,
    skipped_queries: skippedQueries,
    raw_count: all.length,
    voice_count: deduped.length,
    duplicates_removed: all.length - deduped.length,
    generated_at: new Date().toISOString(),
  };

  await writeFile(jsonPath, JSON.stringify(deduped, null, 2));
  await writeFile(csvPath, `${toCsv(deduped)}\n`);
  await writeFile(latestJsonPath, JSON.stringify(deduped, null, 2));
  await writeFile(latestCsvPath, `${toCsv(deduped)}\n`);
  await writeFile(metaPath, JSON.stringify(meta, null, 2));

  process.stdout.write(
    `Saved ${deduped.length} unique voices to ${path.relative(ROOT, jsonPath)} and CSV snapshot.\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
