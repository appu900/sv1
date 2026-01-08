import { PartialType } from '@nestjs/mapped-types';
import { CreateCommunityGroupDto } from './create-community-group.dto';
import { IsNotEmpty, IsString } from 'class-validator';





export class UpdateCommunityGroupDto{


    @IsString()
    name?:string;

    @IsString()
    description?:string

    @IsString()
    @IsNotEmpty()
    groupId:string;
}
