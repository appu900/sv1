import { IsString, IsNotEmpty, MinLength, MaxLength, Matches } from 'class-validator';

export class LinkFFNDto {
  @IsString()
  @IsNotEmpty({ message: 'Frequent Flyer number is required' })
  @MinLength(6, { message: 'FFN must be at least 6 characters' })
  @MaxLength(12, { message: 'FFN must be at most 12 characters' })
  @Matches(/^\d+$/, { message: 'FFN must contain only digits' })
  memberId: string;

  @IsString()
  @IsNotEmpty({ message: 'Surname is required' })
  @MinLength(2, { message: 'Surname must be at least 2 characters' })
  surname: string;
}
