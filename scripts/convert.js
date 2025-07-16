// scripts/convert.js

// Import necessary modules.
const fs = require('fs');
const path = require('path');

// Import the Aseprite parser library.
const Aseprite = require('ase-parser');

// Define the paths for our input and output files.
const sourcePath = path.join(process.cwd(), 'source', 'canvas.aseprite');
const outputPath = path.join(process.cwd(), 'public', 'canvas.json');
const publicDir = path.join(process.cwd(), 'public');

try {
    // --- Step 1: Read the Aseprite file ---
    console.log(`Reading file from: ${sourcePath}`);
    const buffer = fs.readFileSync(sourcePath);

    // --- Step 2: Parse the file data ---
    console.log('Parsing Aseprite data...');
    const ase = new Aseprite(buffer);
    ase.parse();
    
    // --- Step 3: Check for valid data ---
    if (!ase.frames || ase.frames.length === 0) {
        throw new Error('No frames found in the Aseprite file.');
    }
    
    // --- DEBUGGING STEP: Print the structure of the parsed data ---
    // This will show us exactly what properties are available in the 'ase' and 'frame' objects.
    console.log('--- DEBUG: Parsed Aseprite Object Keys ---');
    console.log(Object.keys(ase)); // Prints all top-level properties of the 'ase' object.
    
    const frame = ase.frames[0];
    console.log('--- DEBUG: First Frame Object Keys ---');
    console.log(Object.keys(frame)); // Prints all properties of the first frame.
    // --- END DEBUGGING STEP ---

    // --- Step 4: Format the data for our application ---
    console.log('Formatting data for output...');
    const outputData = {
        width: ase.width,
        height: ase.height,
        frames: [
            {
                // We are trying to access the pixel data here. The debug logs will tell us the correct property name.
                pixels: Array.from(frame.rawImageData)
            }
        ]
    };

    // --- Step 5: Ensure the output directory exists ---
    if (!fs.existsSync(publicDir)){
        fs.mkdirSync(publicDir);
    }

    // --- Step 6: Write the JSON file ---
    console.log(`Writing JSON to: ${outputPath}`);
    fs.writeFileSync(outputPath, JSON.stringify(outputData));

    console.log('Conversion successful!');

} catch (error) {
    // If anything goes wrong, log the error and exit with a failure code.
    console.error('An error occurred during conversion:', error);
    process.exit(1);
}
