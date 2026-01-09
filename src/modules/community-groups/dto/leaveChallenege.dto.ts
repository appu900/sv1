import { IsNotEmpty, isNotEmpty, IsString } from "class-validator";





export class leveChallengeDto{


    @IsString()
    @IsNotEmpty()
    communityId:string;


    @IsString()
    @IsNotEmpty()
    challengeId:string;
}