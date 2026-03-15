import {
    Tekimax,
    OllamaProvider,
    LoggerPlugin,
    PIIFilterPlugin,
    MaxContextOverflowPlugin
} from 'tekimax-omat';

async function testPlugins() {
    console.log("🚀 Starting Plugin Verification Test...\n");

    const client = new Tekimax({
        provider: new OllamaProvider({ host: 'http://localhost:11434' }),
        plugins: [
            new LoggerPlugin(),
            new PIIFilterPlugin(),
            new MaxContextOverflowPlugin(3) // Very small limit to easily test overflow
        ]
    });

    console.log("\n--- Test 1: PII Filter ---");
    // Send a message with built-in PII (email and SSN)
    const result1 = await client.text.chat.completions.create({
        model: 'mistral:latest',
        messages: [{
            role: 'user',
            content: 'My email is john.doe@example.com and my SSN is ***-**-****. Please just reply with "I understand".'
        }],
        temperature: 0
    });
    console.log("\nFinal API Response:", result1.message.content);

    console.log("\n--- Test 2: Max Context Overflow ---");
    // We configured MaxContextOverflowPlugin with a limit of 3.
    // We will send 4 messages and see if the plugin drops the oldest.
    await client.text.chat.completions.create({
        model: 'mistral:latest',
        messages: [
            { role: 'system', content: 'You are a helpful assistant.' }, // Msg 1
            { role: 'user', content: 'Message A' },                      // Msg 2
            { role: 'assistant', content: 'Reply A' },                   // Msg 3
            { role: 'user', content: 'Message B' }                       // Msg 4
        ],
        temperature: 0
    });

    console.log("\n✅ Plugin Verification Complete!");
}

testPlugins().catch(console.error);
