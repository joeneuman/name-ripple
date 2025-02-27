const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const OpenAI = require('openai');

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Middleware
app.use(cors());
app.use(express.json());

// Generate words endpoint
app.post('/api/generate-words', async (req, res) => {
  try {
    const { baseWord } = req.body;
    
    if (!baseWord) {
      return res.status(400).json({ error: 'Base word is required' });
    }

    const response = await openai.completions.create({
      model: "gpt-3.5-turbo-instruct",
      prompt: `SYSTEM: Generate exactly 20 words related to "${baseWord}". Follow these rules:

DO NOT USE ANY:
- Numbers or numbering
- Bullet points
- Prefixes
- Special characters
- Formatting
- Explanations

ONLY output plain words, one per line, like this example:
House
Garden
Kitchen

Your turn. Output 20 related words now:`,
      max_tokens: 200,
      temperature: 0.7
    });

    if (!response.choices?.[0]?.text) {
      throw new Error('No suggestions received from API');
    }

    const words = response.choices[0].text.trim().split('\n').filter(word => word.trim());
    
    if (words.length === 0) {
      throw new Error('No valid words generated');
    }

    res.json({ words });
  } catch (error) {
    console.error('Error generating words:', error);
    res.status(500).json({ 
      error: error.message || 'Error generating word list'
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 