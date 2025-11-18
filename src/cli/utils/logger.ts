/**
 * CLI Logger Utility (~150 LOC)
 *
 * Provides colored console output using ANSI escape codes.
 * NO external dependencies - pure Node.js.
 */

/**
 * ANSI color codes
 */
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
} as const;

/**
 * Color helper functions
 */
export function red(text: string): string {
  return `${COLORS.red}${text}${COLORS.reset}`;
}

export function green(text: string): string {
  return `${COLORS.green}${text}${COLORS.reset}`;
}

export function yellow(text: string): string {
  return `${COLORS.yellow}${text}${COLORS.reset}`;
}

export function blue(text: string): string {
  return `${COLORS.blue}${text}${COLORS.reset}`;
}

export function cyan(text: string): string {
  return `${COLORS.cyan}${text}${COLORS.reset}`;
}

export function gray(text: string): string {
  return `${COLORS.gray}${text}${COLORS.reset}`;
}

export function bold(text: string): string {
  return `${COLORS.bold}${text}${COLORS.reset}`;
}

export function dim(text: string): string {
  return `${COLORS.dim}${text}${COLORS.reset}`;
}

/**
 * Spinner class for progress indication
 */
export class Spinner {
  private readonly frames: readonly string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private interval: NodeJS.Timeout | null = null;
  private currentFrame: number = 0;
  private message: string = '';

  /**
   * Start spinner with message
   */
  start(message: string): void {
    this.message = message;
    this.currentFrame = 0;

    this.interval = setInterval((): void => {
      const frame = this.frames[this.currentFrame];
      if (frame !== undefined) {
        process.stdout.write(`\r${cyan(frame)} ${this.message}`);
      }
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
    }, 80);
  }

  /**
   * Stop spinner with success message
   */
  succeed(message?: string): void {
    this.stop();
    console.log(green('✔'), message ?? this.message);
  }

  /**
   * Stop spinner with failure message
   */
  fail(message?: string): void {
    this.stop();
    console.log(red('✖'), message ?? this.message);
  }

  /**
   * Stop spinner with info message
   */
  info(message: string): void {
    this.stop();
    console.log(blue('ℹ'), message);
  }

  /**
   * Stop spinner and clear line
   */
  private stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      process.stdout.write('\r\x1b[K'); // Clear line
    }
  }
}

/**
 * Logger interface
 */
export interface Logger {
  readonly info: (message: string, ...args: readonly unknown[]) => void;
  readonly success: (message: string, ...args: readonly unknown[]) => void;
  readonly warn: (message: string, ...args: readonly unknown[]) => void;
  readonly error: (message: string, ...args: readonly unknown[]) => void;
  readonly debug: (message: string, ...args: readonly unknown[]) => void;
  readonly log: (message: string) => void;
}

/**
 * Create logger instance
 */
function createLogger(): Logger {
  return {
    info(message: string, ...args: readonly unknown[]): void {
      console.log(blue('ℹ'), message, ...args);
    },

    success(message: string, ...args: readonly unknown[]): void {
      console.log(green('✔'), message, ...args);
    },

    warn(message: string, ...args: readonly unknown[]): void {
      console.log(yellow('⚠'), message, ...args);
    },

    error(message: string, ...args: readonly unknown[]): void {
      console.error(red('✖'), message, ...args);
    },

    debug(message: string, ...args: readonly unknown[]): void {
      if (process.env['DEBUG'] === 'true' || process.env['DEBUG'] === '1') {
        console.log(cyan('🐛'), message, ...args);
      }
    },

    log(message: string): void {
      console.log(message);
    },
  };
}

/**
 * Global logger instance
 */
export const logger: Logger = createLogger();

/**
 * Global spinner instance
 */
export const spinner: Spinner = new Spinner();

/**
 * Format error for display
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Print table to console
 */
export function printTable(rows: readonly (readonly string[])[]): void {
  if (rows.length === 0) {
    return;
  }

  // Calculate column widths
  const columnWidths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index): void => {
      const currentWidth = columnWidths[index] ?? 0;
      columnWidths[index] = Math.max(currentWidth, cell.length);
    });
  }

  // Print rows
  for (const row of rows) {
    const paddedCells = row.map((cell, index): string => {
      const width = columnWidths[index] ?? cell.length;
      return cell.padEnd(width, ' ');
    });
    console.log(paddedCells.join('  '));
  }
}
