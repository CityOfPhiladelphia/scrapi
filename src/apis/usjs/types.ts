/** USJS type definitions */

export enum FileType {
    Summary = 'CpCourtSummary',
    DocketSheet = 'CpDocketSheet'
}

export enum Sentence {
    Date = 'sentenceDt',
    Type = 'sentenceType',
    ProgramPeriod = 'programPeriod',
    Length = 'sentenceLen'
}

export type CourtSentence = {
    [Sentence.Date]?: string,
    [Sentence.Type]?: string,
    [Sentence.ProgramPeriod]?: string,
    [Sentence.Length]?: string
}

export enum Charge {
    SequenceNum = 'seqNo',
    Statute = 'statute',
    Grade = 'grade',
    Description = 'description',
    Disposition = 'disposition',
    Sentence = 'sentence'
}

export type CourtCharges = {
    [Charge.SequenceNum]: string,
    [Charge.Statute]: string,
    [Charge.Grade]: string,
    [Charge.Description]: string,
    [Charge.Disposition]: string,
    [Charge.Sentence]: CourtSentence[]
};

export enum Case {
    DocketNumber = 'docketNo',
    ProcStatus = 'procStatus',
    DCNum = 'dcNo',
    OTN = 'otn',
    ArrestDate = 'arrestDt',
    DispositionDate = 'dispDt',
    DispositionJudge = 'dispJudge',
    DefenseAttorney = 'defenseAtty',
    NextActionDate = 'nextActionDt',
    Charges = 'charges'
}

export type CourtCase = {
    [Case.DocketNumber]: string,
    [Case.ProcStatus]: string,
    [Case.DCNum]: string,
    [Case.OTN]: string,
    [Case.ArrestDate]: string,
    [Case.DispositionDate]: string,
    [Case.DispositionJudge]: string,
    [Case.DefenseAttorney]: string,
    [Case.NextActionDate]: string,
    [Case.Charges]: CourtCharges[]
};

export enum Defendant {
    Name = 'name',
    FirstName = 'firstName',
    MiddleName = 'middleName',
    LastName = 'lastName',
    Address = 'address',
    DOB = 'dob',
    Race = 'race',
    Hair = 'hair',
    Eyes = 'eyes',
    Sex = 'sex',
    Aliases = 'aliases',
}

export type SerializedSummary = {
    person: {
        [Defendant.Name]: string;
        [Defendant.FirstName]: string;
        [Defendant.MiddleName]: string;
        [Defendant.LastName]: string;
        [Defendant.Address]: string;
        [Defendant.DOB]: string;
        [Defendant.Race]: string;
        [Defendant.Hair]: string;
        [Defendant.Eyes]: string;
        [Defendant.Sex]: string;
        [Defendant.Aliases]: string[];
    };
    cases: CourtCase[];
    summaryUrl?: string | null;
};

export type PersonSearchResult = {
    searchCriteria: {
        firstName: string;
        lastName: string;
        dob: string;
    };
    foundCases: Array<{
        docketNumber: string;
        filingDate: string;
        otn: string;
    }>;
    totalCount: number;
};

/** Key-value matching parameters for regex extraction */
export type KVMatch = {
    line: string,
    regex: RegExp
};

/** Slicing function parameters */
export type SliceProps = {
    lines: string[],
    reducer: (acc: number[], line: string, idx: number) => number[]
};
