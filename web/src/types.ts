/// Shape of a service as returned by the Marketplace contract, plus the
/// service id (which `getService` doesn't echo back but pagination calls
/// return in a parallel array). Pages normalise contract results into
/// this shape so downstream components don't have to know about ethers
/// tuple indexing.
export interface Service {
  id: bigint;
  provider: string;
  name: string;
  description: string;
  endpoint: string;
  category: number;
  active: boolean;
  createdAt: bigint;
  subscriberCount: bigint;
}

/// Raw ethers tuple from `getService` / pagination return values.
/// Both indexed and named access are supported in ethers v6.
export interface RawServiceTuple {
  provider: string;
  name: string;
  description: string;
  endpoint: string;
  category: bigint;
  active: boolean;
  createdAt: bigint;
  subscriberCount: bigint;
}

export function normalizeService(id: bigint, raw: RawServiceTuple): Service {
  return {
    id,
    provider: raw.provider,
    name: raw.name,
    description: raw.description,
    endpoint: raw.endpoint,
    category: Number(raw.category),
    active: raw.active,
    createdAt: raw.createdAt,
    subscriberCount: raw.subscriberCount,
  };
}
