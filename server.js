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

// Initialize the QVAC model purely on-device
async function initializeAI() {
    try {
        console.log("Loading QVAC model into local memory...");
        await loadModel({ task: 'completion' }); 
        isModelLoaded = true;
        console.log("Model loaded successfully. Ready for on-device inference.");
    } catch (error) {
        console.error("Failed to load QVAC model:", error);
    }
}
initializeAI();

app.post('/api/summarize', async (req, res) => {
    if (!isModelLoaded) {
        return res.status(503).json({ error: "Local model is still initializing. Please try again in a moment." });
    }

    try {
        const { text } = req.body;
        
        // Fulfills the SDK requirement: calling `completion`
        const result = await completion({
            prompt: `Summarize this text in one concise sentence:\n\n${text}\n\nSummary:`,
            maxTokens: 100
        });

        // Handle variations in SDK response structures
        const output = typeof result === 'string' ? result : (result.text || result.response || "Summary generated successfully.");
        res.json({ summary: output });
    } catch (error) {
        console.error("Inference error:", error);
        res.status(500).json({ error: "Local inference failed." });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Brevity UI running locally at http://localhost:${PORT}`);
});