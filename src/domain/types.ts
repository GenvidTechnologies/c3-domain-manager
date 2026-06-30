// FunctionParameter is owned by @genvidtech/c3source (identical shape); re-exported
// here so consumers of this package keep importing it from one place.
export type { FunctionParameter } from "@genvidtech/c3source";

import { z } from "zod";

const RelationshipSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    type: z.enum(["shared-kernel", "customer-supplier", "conformist", "anti-corruption-layer", "open-host-service"]),
    description: z.string().optional(),
  })
  .passthrough();

const DomainDefinitionSchema = z
  .object({
    description: z.string(),
    eventSheetDirs: z.array(z.string()).optional(),
    layoutDirs: z.array(z.string()).optional(),
    scriptDirs: z.array(z.string()).optional(),
    strategy: z.enum(["core", "supporting", "generic"]).optional(),
    glossary: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const SharedSubdomainDefinitionSchema = DomainDefinitionSchema;

export const DomainConfigSchema = z
  .object({
    domains: z.record(z.string(), DomainDefinitionSchema),
    sharedSubdomains: z.record(z.string(), SharedSubdomainDefinitionSchema).optional(),
    overrides: z.record(z.string(), z.string()).optional(),
    relationships: z.array(RelationshipSchema).optional(),
  })
  .passthrough();

export type Relationship = z.infer<typeof RelationshipSchema>;
export type DomainDefinition = z.infer<typeof DomainDefinitionSchema>;
export type SharedSubdomainDefinition = z.infer<typeof SharedSubdomainDefinitionSchema>;
export type DomainConfig = z.infer<typeof DomainConfigSchema>;

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
  /** domain → variable names this domain references that the keyed domain declares (event-variable coupling, outgoing) */
  referencesFrom: Map<string, string[]>;
  /** domain → variable names of this domain's that the keyed domain references (event-variable coupling, incoming) */
  referencedBy: Map<string, string[]>;
  /** True if this domain is a shared subdomain (from config.sharedSubdomains) */
  isSharedSubdomain?: boolean;
  /** Strategic classification from DDD */
  strategy?: "core" | "supporting" | "generic";
}
