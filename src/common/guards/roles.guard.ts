import { CanActivate, ExecutionContext, ForbiddenException,Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "../decorators/role.decorators";

@Injectable()
export class RolesGuard implements CanActivate{
    constructor(private readonly reflactor:Reflector){}
    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflactor.getAllAndOverride<string[]>(ROLES_KEY,[context.getHandler(),context.getClass()])
        if(!requiredRoles || requiredRoles.length === 0) return true
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        console.log(user)
        if(!user || !requiredRoles.includes(user.role)){
            throw new ForbiddenException("Insufficient permissions")
        }
        return true;
    }
}