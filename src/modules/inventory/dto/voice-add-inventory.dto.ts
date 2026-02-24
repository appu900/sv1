import { IsString, IsNotEmpty } from 'class-validator';

export class VoiceAddInventoryDto {
  @IsString()
  @IsNotEmpty()
  transcript: string;
}
