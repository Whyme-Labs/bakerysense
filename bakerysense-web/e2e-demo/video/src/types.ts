/** A single timed step within a test scenario */
export interface TimingEntry {
  /** Scenario ID (e.g. "auth-flow") */
  scenario: string;
  /** 1-based step number within the scenario */
  step: number;
  /** Kebab-case step identifier (e.g. "click-login-button") */
  step_id: string;
  /** Human-readable description shown as caption */
  description: string;
  /** Milliseconds from start of this scenario's recording */
  timestamp_ms: number;
  /** Milliseconds from start of session.webm (global recording timeline) */
  session_ms: number;
  /** How long the element-based wait took (ms) */
  wait_duration_ms: number;
  /** Extra ms held after the wait resolves (for visual emphasis) */
  dwell_ms?: number;
  /** Screenshot filename relative to e2e/screenshots/ */
  screenshot: string;
  /** Video filename relative to e2e/recordings/ */
  video_file: string;
}

/** A single step in the test plan (before execution) */
export interface TestPlanStep {
  action: "navigate" | "click" | "fill" | "select" | "hover" | "scroll" | "press";
  /** CSS selector or URL (for navigate action) */
  target: string;
  /** CSS selector to wait for after action completes */
  wait_for: string;
  /** Whether to capture a screenshot at this step */
  screenshot: boolean;
  /** Human-readable step description */
  description: string;
  /** Value to fill (for fill/select actions) */
  value?: string;
  /** Key to press (for press action) */
  key?: string;
}

/** A test scenario containing ordered steps */
export interface TestScenario {
  /** Unique kebab-case ID */
  id: string;
  /** Human-readable scenario name */
  name: string;
  /** Brief description of what this scenario tests */
  description: string;
  steps: TestPlanStep[];
}

/** Top-level test plan structure */
export interface TestPlan {
  scenarios: TestScenario[];
  config: TestPlanConfig;
}

export interface TestPlanConfig {
  base_url: string;
  viewport: { width: number; height: number };
  video: boolean;
  voiceover: boolean;
}

/** Error log entry written by test executor, read by error watcher */
export interface ErrorLogEntry {
  timestamp: string;
  type: "console-error" | "page-error" | "network-error";
  message: string;
  stack?: string;
  url?: string;
  status_code?: number;
  scenario: string;
  step: number;
}

/** Auth bypass revert checklist entry */
export interface RevertEntry {
  file_path: string;
  change_type: "modified" | "created";
  original_content?: string;
  description: string;
}
