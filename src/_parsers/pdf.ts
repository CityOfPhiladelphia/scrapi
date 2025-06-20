import assert from 'assert';
import fs from 'fs';
import { PDFExtract } from 'pdf.js-extract';

type Coordinate = { x: number, y: number, str: string };
const sortBy = { 
    x: (data: Coordinate[]) => data.sort((a, b) => a.x - b.x),
    y: (data: Coordinate[]) => data.sort((a, b) => a.y - b.y),
}

const lines = (elements: Coordinate[], tolerance = 3): string[] => { 
    const { lines } = [...elements]
    .sort((a, b) => a.y - b.y)
    .reduce((acc, el) => {
        // If current element is outside tolerance of current line, start a new line
        if (Math.abs(el.y - acc.current.y) > tolerance) {
            // Sort current line by x-position & push to lines
            const sortedLine = sortBy.x(acc.current.line);
            const lineText = sortedLine.map(e => e.str).join(' |').trim();
            acc.lines.push(lineText);

            acc.current.line = [el]; // Start new line
            acc.current.y = el.y; // Update current y
            return acc;
        };

        acc.current.line.push(el); // Add to current line
        return acc;
    }, {
        current: {
            line: []  as Coordinate[],
            y: elements[0].y ?? 0
        },
        lines: [] as string[]
    });

    return lines;
}



export const pdf = {
    extract: async (pdfPath: string) => {
        assert(fs.existsSync(pdfPath), `PDF file does not exist: ${pdfPath}`);
        const pdfExtract = new PDFExtract();
        
        const result = await pdfExtract.extract(pdfPath, {});
        return result;
    },
    lines: {
        group: lines,
        sortBy
    }
}