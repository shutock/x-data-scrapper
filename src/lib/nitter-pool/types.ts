export type InstanceStatus = "healthy" | "unhealthy" | "rate_limited";

export interface NitterInstance {
  url: string;
  status: InstanceStatus;
  consecutiveFailures: number;
  lastChecked: number;
  avgResponseTime: number;
  rateLimitedUntil: number | null;
}

export interface HealthCheckResult {
  url: string;
  healthy: boolean;
  responseTime: number;
  error?: string;
}
