import { Injectable } from '@nestjs/common';
import { OpenAI } from 'openai/client.js';
@Injectable()
export class CookbookaiService {
    getHello(): string {
        return 'Hello World! from cook book ai';
    }
    async createRecipe(ingredients: string[]) {
        const openai = new OpenAI();
        return `Here is a recipe you can make with ${ingredients.join(', ')}: ...`;
    }
}
