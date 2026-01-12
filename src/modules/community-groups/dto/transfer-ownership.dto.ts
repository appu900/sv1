import { IsNotEmpty, IsString } from 'class-validator';

export class TransferOwnershipDto {
  @IsNotEmpty()
  @IsString()
  groupId: string;

  @IsNotEmpty()
  @IsString()
  newOwnerId: string;
}
