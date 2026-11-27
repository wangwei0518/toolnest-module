export interface CompanyProfile {
  companyName: string | null;
  companyWorld: string | null;
  companyRank: number | null;
  companyGrandCompany: string | null;
  companyLeaderName: string | null;
  companyTotalMembers: number | null;
}
export interface Company extends CompanyProfile {
  companyId: string;
  alias: string;
}
export interface Item {
  itemId: number;
  name: string;
  quantity: number;
  npcUnitPriceGil: number | null;
  subtotalGil: number | null;
}
export interface Vessel {
  slot: number;
  name: string;
  nextCompletionTimestamp: number | null;
}
export interface Report extends CompanyProfile {
  companyId: string;
  date: string;
  generatedAt: string;
  trigger: "manual" | "completion";
  totalGil: number;
  items: Item[];
  submersibles: Vessel[] | null;
}
export interface Fleet {
  generatedAt: string;
  submersibles: Vessel[];
}
export interface TrendPoint {
  date: string;
  totalGil: number;
}
export interface Dashboard {
  company: Company;
  latest: Report | null;
  today: string;
  now: string;
  month: string;
  months: string[];
  todayReport: Report | null;
  yesterdayTotalGil: number | null;
  fleet: Fleet | null;
  reports: Report[];
  trend: TrendPoint[];
}
export interface Credential {
  companyId: string;
  token: string;
}
