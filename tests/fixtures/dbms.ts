/**
 * A DBMS normalization lecture as a PDF extractor would emit it: running header, page-number footers,
 * words hyphenated across lines and wrapped sentences. Used by the ingestion tests.
 */
export const DBMS_PAGES: string[] = [
  `DBMS Lecture Notes - Unit 3
3.1 Normalization
Normalization is the process of organizing the columns and tables of a relational
database to minimize data redundancy. Redundant data wastes storage and causes update
anomalies, so well designed schemas are normal-
ized step by step. A decomposition must be lossless so that no information is lost.
Anomaly: an update, insertion or deletion problem caused by redundant data in a table.
Page 1`,
  `DBMS Lecture Notes - Unit 3
3.2 Functional Dependency
A functional dependency is a constraint between two sets of attributes in a relation. We write X -> Y when
every value of X determines exactly one value of Y. Functional dependency theory drives every
normal form, and each functional dependency should be checked against the candidate keys of the relation.
Candidate key refers to a minimal set of attributes that uniquely identifies every tuple in a relation.
Page 2`,
  `DBMS Lecture Notes - Unit 3
FIRST NORMAL FORM
First Normal Form (1NF) is a property of a relation in which every attribute holds only atomic values.
A relation in 1NF has no repeating groups and no multivalued attributes, which keeps every normal form
that follows simple to define. Atomic value — a value that cannot be divided into smaller meaningful parts.
Page 3`,
  `DBMS Lecture Notes - Unit 3
3.3 Boyce-Codd Normal Form
BCNF means that for every functional dependency X -> Y in a relation, X must be a superkey of that relation.
This is stricter than third normal form. It removes the remaining anomalies caused by overlapping candidate
keys, and a BCNF decomposition may not preserve every functional dependency.
Page 4`,
];

export const DBMS_TEXT = DBMS_PAGES.join('\n');
