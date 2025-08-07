import { stringify } from 'csv-stringify/sync';
import { config } from 'dotenv';
import { Charge, SerializedSummary } from '../src/apis/usjs/types';
import { writeFileSync } from 'fs';

config();

type Row = {
    DocketNo: string;
    First: string;
    'Middle Name or Initial': string;
    'Last name': string;
    Aliases: string;
    Zip: string;
    DOB: string;
    Race: string;
    Sex: string;
    'Case Status': string;
    County: string;
    Charges: string;
    Disposition: string;
    'Grade(s)': string;
    'Sentence?': 'yes' | 'no';
    'Min Sentence?': string;
    'Max Sentence?': string;
    'Disposition Date': string;
    'Warrant?': boolean;
    'Representation Type': string;
    'next action case?': string // this one may be tough to do
    'Case Balance': string;
    'Restitution Amount': string;
    'Restitution Owed to': string;
};


// Start w/ base logic, wrap in cmdline? basic HTML file?
// Accept CSV? 
export const main = async (docketNum: string) => {
        // Pull docket Num from .env;
        const summary = await fetch(process.env.API_ENDPOINT + 'summary?docketNum=' + docketNum, {
            headers: {
                'x-api-key': process.env.API_KEY!
            },
            method: 'GET'
        });

        const data = await summary.json();
        const { person, cases } = data as SerializedSummary;
        const [last, firstMid] = person.name.split(',');
        const [first, middle] = firstMid.split(' ');

        const rows = await cases.reduce(async (prev, { docketNo, procStatus, charges, dispDt }) => { 
            // Call out for Docket Sheet
            const acc = await prev;
            console.dir(docketNo);
            const docket = await fetch(process.env.API_ENDPOINT + 'docket?docketNum=' + docketNo, {
                headers: {
                    'x-api-key': process.env.API_KEY!
                },
                method: 'GET'
                });
            const { zipcode, balance } = await docket.json();

            const Charges = charges.map(charge => charge[Charge.Description]).join(', ');
            const Grades = charges.map(charge => charge[Charge.Grade]).join(', ');
            const Disposition = charges.map(charge => charge[Charge.Disposition]).join(', ');
            // Sentence type => boolean .any 
            const Sentence = charges.some((charge) => { 
                if(charge[Charge.Sentence].length === 0) return false;

                return charge[Charge.Sentence].some((sentence) => {
                    const { sentenceType } = sentence;
                    return sentenceType?.includes('Probation') ? true :
                            sentenceType?.includes('Confinement') ? true :
                            sentenceType?.includes('Diversion') ? true : 
                            false;
                });
            });

            const row = {
                DocketNo: docketNo,
                First: first, 
                "Middle Name or Initial": middle,
                "Last name": last,
                Aliases: person.aliases.join(','),
                Zip: zipcode,
                DOB: person.dob,
                Race: person.race,
                Sex: person.sex,
                'Case Status': procStatus,
                County: '',
                Charges,
                Disposition,
                'Grade(s)': Grades,
                'Sentence?': Sentence === true ? 'yes' : 'no',
                'Min Sentence?': '',
                'Max Sentence?': '',
                'Disposition Date': dispDt,
                'Warrant?': false,
                'Representation Type': '',
                'next action case?': '',
                'Case Balance': balance,
                'Restitution Amount': '',
                'Restitution Owed to': ''
            } as Row

            console.dir(row);
            return [...acc, row];
        }, Promise.resolve([] as Row[]))

        const csv = stringify(rows, {
            header: true,
            columns: Object.keys(rows[0])
        });

        writeFileSync('out.csv', csv);
        return csv;
    }

    main(process.env.DOCKET_TEST!);