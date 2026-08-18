export class QantasFFNResponseDto {
  _id: string;
  userId: string;
  memberId: string;
  surname: string;
  isLinked: boolean;
  linkStatus: string;
  linkedAt: string;
  isRewarded: boolean;
  surveysCompletedSinceLink: number;
  totalPointsAwarded: number;
  greenTierUnlocked: boolean;
  expirationDate: string | null;
  link_response: {
    qffReference: {
      memberId: string;
    };
  };
}

export class QantasDashboardDto {
  ffn: QantasFFNResponseDto;
  surveysInCycle: number;
  surveysRequired: number;
  pointsPerCycle: number;
  greenTierUnlocked: boolean;
  totalPointsAwarded: number;
  isRewarded: boolean;
  progress: number; // 0–1
  pendingAllocation: boolean;
  pointsHistory: {
    points: number;
    reason: string;
    awardedAt: string;
    accrualReferenceNumber: string | null;
  }[];
}
