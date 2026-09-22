import express from 'express';
import { loadModel, completion } from '@qvac/sdk';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let isModelLoaded = false;
let modelLoadInProgress = false;
let activeModelId = null;
const MODEL_URL = "https://huggingface.co/Qwen/Qwen1.5-0.5B-Chat-GGUF/resolve/main/qwen1_5-0_5b-chat-q4_k_m.gguf";
const MAX_MODEL_LOAD_RETRIES = 3;

async function initializeAI(retryCount = 0) {
    if (modelLoadInProgress) {
        return;
    }

    modelLoadInProgress = true;

    try {
        console.log("Downloading and loading QVAC model into local memory...");
        activeModelId = await loadModel({
            modelSrc: MODEL_URL,
            modelType: 'llamacpp-completion'
        });
        isModelLoaded = true;
        modelLoadInProgress = false;
        console.log("Model loaded successfully. Ready for on-device inference.", activeModelId);
    } catch (error) {
        modelLoadInProgress = false;
        const shouldRetry = retryCount < MAX_MODEL_LOAD_RETRIES;
        console.error(`Failed to load QVAC model (attempt ${retryCount + 1}/${MAX_MODEL_LOAD_RETRIES + 1}):`, error);

        if (shouldRetry) {
            const delayMs = 2000 * (retryCount + 1);
            console.warn(`Retrying model load in ${delayMs / 1000}s...`);
            setTimeout(() => initializeAI(retryCount + 1), delayMs);
            return;
        }

        console.error("Model initialization failed after retries. The app will remain available but inference is unavailable.");
    }
}
initializeAI();

async function summarizePass(text, instruction) {
    const run = completion({
        modelId: activeModelId,
        history: [
            { role: 'system', content: instruction },
            { role: 'user', content: `Text to summarize:\n\n${text}` }
        ],
        stream: true
    });

    let outputText = '';
    for await (const token of run.tokenStream) {
        outputText += token;
    }

    const finalResult = await run.final;
    return (finalResult?.text || outputText).trim();
}

function extractImportantSentences(text) {
    const sentences = (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text]).map((sentence) => sentence.trim()).filter(Boolean);

    const scored = sentences.map((sentence) => {
        const lower = sentence.toLowerCase();
        const score =
            (lower.match(/\d+/g) || []).length * 5 +
            (lower.match(/\b(?:plan|strategy|announced|increase|decrease|launch|improve|expected|response|satisfaction|phase|rollout|review|goal|decision|outcome|result|impact|deadline|milestone|audit|risk|benefit|forecast|growth|reduction)\b/g) || []).length * 3 +
            (sentence.split(/\s+/).length > 18 ? 2 : 0) +
            (sentence.includes(':') ? 1 : 0);

        return { sentence, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const selected = scored.slice(0, 5).map((item) => item.sentence);
    return selected.length ? selected : sentences.slice(0, 3);
}

async function generateSummary(text) {
    const importantSentences = extractImportantSentences(text);
    const structuredSummary = importantSentences.map((sentence) => `• ${sentence}`).join('\n');

    const summary = await summarizePass(
        text,
        'Write a detailed summary in 5 bullet points. Each bullet must be a full sentence and should capture one major idea, fact, decision, date, number, or outcome. Include critical details and avoid brief generic phrasing.'
    );

    const trimmedText = text.trim();
    const shouldPreferStructured = summary.length < Math.min(260, Math.max(120, trimmedText.length * 0.12));

    if (shouldPreferStructured) {
        return structuredSummary || summary;
    }

    return summary || structuredSummary;
}

app.get('/api/status', (req, res) => {
    res.json({
        ready: isModelLoaded,
        loading: modelLoadInProgress,
        modelId: activeModelId
    });
});

app.post('/api/summarize', async (req, res) => {
    if (!isModelLoaded || !activeModelId) {
        return res.status(503).json({ error: "Local model is still initializing. Please wait." });
    }

    try {
        const { text } = req.body;
        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({ error: 'Text is required.' });
        }

        const summary = await generateSummary(text);
        res.json({ summary: summary || 'No summary generated.' });
    } catch (error) {
        console.error("Inference error:", error);
        res.status(500).json({ error: "Local inference failed." });
    }
});

const DEFAULT_PORT = Number(process.env.PORT) || 3001;

function startServer(port) {
    const server = app.listen(port, () => {
        console.log(`Brevity UI running locally at http://localhost:${port}`);
    });

    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.warn(`Port ${port} is busy. Retrying on ${port + 1}...`);
            startServer(port + 1);
            return;
        }

        throw error;
    });
}

startServer(DEFAULT_PORT);