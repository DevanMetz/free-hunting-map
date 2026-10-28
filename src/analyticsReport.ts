export interface Audience { users:number; new:number; returning:number; installed:number; browser:number }
export interface AnalyticsDay extends Audience { day:string; internal:number }
export interface FeatureUsage { feature:string; users:number; uses:number; ok:number; fail:number; okRate:number|null; failRate:number|null }
export interface TrafficSummary { today:number; days7:number; days30:number; audience:Audience; opens:number; featureUses:number }
export interface AnalyticsReport {
  from:string; to:string; real:TrafficSummary; internal:TrafficSummary;
  days:AnalyticsDay[]; features:FeatureUsage[]; countries:{country:string; users:number}[];
}
