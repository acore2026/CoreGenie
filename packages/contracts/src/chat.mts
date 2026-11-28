export interface Question {
  kind: "choice" | "input";
  question: string;
  inputType?: string;
  placeholder?: string;
  options?: string[];
  multiSelect?: boolean;
  allowOther?: boolean;
  optionDescriptions?: string[];
}
export interface Answer {
  skipped?: boolean;
  answer?: string | string[] | null;
}
export interface SurveyResult {
  timedOut?: boolean;
  resolved?: boolean;
  skipped?: boolean;
  answers?: Answer[];
}
export interface Survey {
  questions?: Question[];
  result?: SurveyResult;
}
export interface ChatMetrics {
  duration?: number;
  outputTps?: number;
  model?: string;
  timestamp?: number;
}
