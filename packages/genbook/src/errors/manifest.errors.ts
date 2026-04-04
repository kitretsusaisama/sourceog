// packages/genbook/src/errors/manifest.errors.ts
// Alibaba CTO 2027 Standard — Manifest & Asset Resolution Errors

import { SourceOGBaseError, ErrorCategory, ErrorSeverity } from './base.js';

/**
 * Base class for errors related to module manifests, asset maps, and routing metadata.
 */
export abstract class ManifestBaseError extends SourceOGBaseError {
  public readonly category: ErrorCategory = 'manifest';
  public readonly severity: ErrorSeverity = 'critical';
  public readonly isFatal = true;
}

/**
 * Thrown when a manifest path resolution attempts to traverse outside the
 * designated project root (e.g., "../../../etc/passwd").
 * This is a critical security violation.
 */
export class ManifestTraversalError extends ManifestBaseError {
  public readonly code = 'MANIFEST_PATH_TRAVERSAL';

  constructor(
    public readonly routeFile: string,
    public readonly projectRoot: string
  ) {
    super(
      `Security violation: Manifest resolution for "${routeFile}" attempted to traverse outside project root "${projectRoot}".`,
      { metadata: { routeFile, projectRoot } }
    );
  }

  public override get resolutionHint(): string {
    return 'Ensure route files are located within the project root and do not contain invalid segments like "..".';
  }
}

/**
 * Thrown when a manifest file is physically missing from the disk
 * at the expected location.
 */
export class ManifestNotFoundError extends ManifestBaseError {
  public readonly code = 'MANIFEST_MISSING';

  constructor(
    public readonly manifestPath: string,
    public readonly routeId?: string
  ) {
    super(
      `Manifest file not found at "${manifestPath}"${routeId ? ` for route "${routeId}"` : ''}.`,
      { metadata: { manifestPath, routeId } }
    );
  }

  public override get resolutionHint(): string {
    return `Run the build command to generate manifests, or verify the path "${this.manifestPath}".`;
  }
}

/**
 * Thrown when a manifest file contains invalid JSON or fails schema validation
 * (e.g., missing "id" or "chunks" fields in a client reference).
 */
export class ManifestParseError extends ManifestBaseError {
  public readonly code = 'MANIFEST_PARSE_FAILED';

  constructor(
    public readonly manifestPath: string,
    public readonly reason: string,
    cause?: unknown
  ) {
    super(
      `Failed to parse manifest "${manifestPath}": ${reason}`,
      { cause, metadata: { manifestPath, reason } }
    );
  }

  public override get resolutionHint(): string {
    return `Validate the JSON structure of "${this.manifestPath}". Ensure it matches the SourceOG Client Reference Manifest schema.`;
  }
}

/**
 * Thrown when a client reference entry is invalid or incomplete
 * (e.g., missing export name or module ID).
 */
export class ManifestEntryError extends ManifestBaseError {
  public readonly code = 'MANIFEST_ENTRY_INVALID';

  constructor(
    public readonly manifestPath: string,
    public readonly entryKey: string,
    public readonly missingField: string
  ) {
    super(
      `Invalid manifest entry "${entryKey}" in "${manifestPath}". Missing required field: "${missingField}".`,
      { metadata: { manifestPath, entryKey, missingField } }
    );
  }

  public override get resolutionHint(): string {
    return `Check the build output for the module associated with "${this.entryKey}". The compiler may have failed to generate a valid reference ID.`;
  }
}