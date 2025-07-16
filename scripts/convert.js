// scripts/convert.js

// Import necessary modules. 'fs' for file system operations, 'path' for handling file paths.
const fs = require('fs');
const path = require('path');

// Import the Aseprite parser library.
const { parse } = require('aseprite-parser');

// Define the paths for our input and output files.
// process.cwd() gives the root directory of our project in the GitHub runner.
const sourcePath = path.join(process.cwd(), 'source', 'canvas.aseprite');
const outputPath = path.join(process.cwd(), 'public', 'canvas.json');
const publicDir = path.join(process.cwd(), 'public');

try {
    // --- Step 1: Read the Aseprite file ---
    // We read the file into a Buffer, which is what the parser expects.
    console.log(`Reading file from: ${sourcePath}`);
    const buffer = fs.readFileSync(sourcePath);

    // --- Step 2: Parse the file data ---
    // The parse function processes the buffer and returns a structured object.
    console.log('Parsing Aseprite data...');
    const aseprite = parse(buffer);
    
    // --- Step 3: Check for valid data ---
    if (!aseprite.frames || aseprite.frames.length === 0) {
        throw new Error('No frames found in the Aseprite file.');
    }

    // --- Step 4: Format the data for our application ---
    // We create a new object that matches the exact structure our index.html expects.
    console.log('Formatting data for output...');
    const frame = aseprite.frames[0];
    const outputData = {
        width: aseprite.width,
        height: aseprite.height,
        frames: [
            {
                // The parser provides the raw pixel data in a Uint8Array.
                // We need to convert it to a regular Array for JSON serialization.
                pixels: Array.from(frame.rawImageData)
            }
        ]
    };

    // --- Step 5: Ensure the output directory exists ---
    // This is a safety check.
    if (!fs.existsSync(publicDir)){
        fs.mkdirSync(publicDir);
    }

    // --- Step 6: Write the JSON file ---
    // We convert our formatted object into a JSON string and write it to the output file.
    console.log(`Writing JSON to: ${outputPath}`);
    fs.writeFileSync(outputPath, JSON.stringify(outputData));

    console.log('Conversion successful!');

} catch (error) {
    // If anything goes wrong, log the error and exit with a failure code.
    // This will make the GitHub Action fail and show us the error message.
    console.error('An error occurred during conversion:', error);
    process.exit(1);
}
