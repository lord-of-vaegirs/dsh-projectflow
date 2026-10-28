export type ProjectErrorCode =
  | 'INVALID_ARGUMENT'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_AMBIGUOUS'
  | 'PROJECT_EXISTS'
  | 'PROJECT_ARCHIVED'
  | 'NOT_BOUND'
  | 'CORRUPT_DATA'
  | 'CAPACITY'
  | 'LOCK_TIMEOUT'
  | 'ENTRY_TOO_LARGE'
  | 'SESSION_REQUIRED'
  | 'AGENT_REQUIRED'
  | 'WORKSPACE_NOT_FOUND'
  | 'IO_ERROR'

/**
 * One readable, actionable failure. Host adapters translate this to a tool
 * error or a command result without leaking memory bodies into logs.
 */
export class ProjectError extends Error {
  readonly code: ProjectErrorCode
  readonly next: string | undefined

  constructor(code: ProjectErrorCode, message: string, next?: string) {
    super(message)
    this.name = 'ProjectError'
    this.code = code
    this.next = next
  }

  toJSON(): { code: ProjectErrorCode; message: string; next?: string } {
    return {
      code: this.code,
      message: this.message,
      ...(this.next === undefined ? {} : { next: this.next }),
    }
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ProjectError) {
    return error.next === undefined ? error.message : `${error.message} ${error.next}`
  }
  return error instanceof Error ? error.message : String(error)
}

export function asProjectError(error: unknown): ProjectError {
  if (error instanceof ProjectError) return error
  return new ProjectError('IO_ERROR', errorMessage(error))
}
