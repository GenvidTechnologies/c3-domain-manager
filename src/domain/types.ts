// FunctionParameter is owned by @genvid/c3source (identical shape); re-exported
// here so consumers of this package keep importing it from one place.
export type { FunctionParameter } from "@genvid/c3source";

export interface Relationship {
  from: string;
  to: string;
  type: "shared-kernel" | "customer-supplier" | "conformist" | "anti-corruption-layer" | "open-host-service";
  description?: string;
}

export interface DomainConfig {
  domains: Record<string, DomainDefinition>;
  sharedSubdomains?: Record<string, SharedSubdomainDefinition>;
  overrides?: Record<string, string>;
  relationships?: Relationship[];
}

export interface DomainDefinition {
  description: string;
  eventSheetDirs?: string[];
  layoutDirs?: string[];
  scriptDirs?: string[];
  strategy?: "core" | "supporting" | "generic";
  glossary?: Record<string, string>;
}

export interface SharedSubdomainDefinition extends DomainDefinition {}

export interface FunctionDef {
  name: string;
  params: string;
  returnType: string;
  sourceSheet: string;
  objectClass?: string;
  aceName?: string;
}

export interface DomainData {
  name: string;
  description: string;
  eventSheets: Array<{ path: string; directory: string }>;
  layouts: Array<{ path: string; eventSheet: string; eventSheetDomain: string }>;
  scripts: Array<{ path: string; isDirectory: boolean }>;
  functions: FunctionDef[];
  includesFrom: Map<string, string[]>;
  includedBy: Map<string, string[]>;
  /** True if this domain is a shared subdomain (from config.sharedSubdomains) */
  isSharedSubdomain?: boolean;
  /** Strategic classification from DDD */
  strategy?: "core" | "supporting" | "generic";
}
