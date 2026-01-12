import { Types } from "mongoose";


export function isValidObjectId(id:string){
    return Types.ObjectId.isValid(id);
}