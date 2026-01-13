
export interface CacheInvalidationEvent{
    eventType:'CACHE_INVALIDATION'
    baseKey:string;
    invalidateVersions:number[];
    timestamp:number;
}