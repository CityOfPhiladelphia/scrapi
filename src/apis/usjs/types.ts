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
    Charges = 'charges'
}

export type CourtCase = {
    [Case.DocketNumber]: string,
    [Case.ProcStatus]: string,
    [Case.DocketNumber]: string,
    [Case.OTN]: string,
    [Case.ArrestDate]: '',
    [Case.DCNum]: '',
    [Case.DispositionDate]: '',
    [Case.DispositionJudge]: '',
    [Case.DefenseAttorney]: '',
    [Case.Charges]: CourtCharges[]
};

export enum Defendant {
    Name = 'name',
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
        [Defendant.Address]: string;
        [Defendant.DOB]: string;
        [Defendant.Race]: string;
        [Defendant.Hair]: string;
        [Defendant.Eyes]: string;
        [Defendant.Sex]: string;
        [Defendant.Aliases]: string[];
    };
    cases: CourtCase[];
}; 

