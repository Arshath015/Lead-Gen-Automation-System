export interface IcpFilters {
  personTitles: string[];
  personLocations: string[];
  organizationLocations: string[];
  organizationDomains: string[];
  employeeRanges: string[]; // e.g. "1,10", "11,50"
  keywords: string;
}

export interface IcpProfile {
  id: string;
  name: string;
  filters: IcpFilters;
  createdAt: string;
  updatedAt: string;
}

export type NewIcpProfile = {
  name: string;
  filters: IcpFilters;
};
