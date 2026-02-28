import { Injectable } from '@nestjs/common';

@Injectable()
export class CookbookaiService {
    getHello(): string {
        return 'Hello World! from cook book ai';
    }
}
