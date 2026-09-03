import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class UserLoginDto {
  /** Account email. */
  @IsEmail()
  @IsNotEmpty()
  email: string;

  /** Account password. */
  @IsString()
  @IsNotEmpty()
  password: string;
}
