import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { userRecipe, UserRecipeDocument } from 'src/database/schemas/user.schema';
import { UserService } from '../user/user.service';
import { RecipeService } from '../recipe/recipe.service';

@Injectable()
export class CookbookaiService {
    constructor(
        @InjectModel(userRecipe.name) private readonly userRecipeModel: Model<UserRecipeDocument>,
        private readonly userService: UserService,
        private readonly recipeService: RecipeService,
        private readonly configService: ConfigService,
    ) { }

    getHello(): string {
        return 'Hello World! from cook book ai';
    }

    async callAdminAi(message: string, userid: string) {
        try {
            const apiUrl = this.configService.get<string>('apiforadmin') || 'http://localhost:3001/api/ai/agentv2';
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: userid,
                    messages: [
                        {
                            role: 'user',
                            content: message
                        }
                    ]
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            if(data.completed){
                return {
                    success: true,
                    message: 'AI processed the recipe request successfully.',
                    data: data.data.recipe
                };
            }
            else{
                return {
                    success: false,
                    message: 'AI failed to process the recipe request.',
                };
            }
        } catch (error) {
            console.error('Error calling admin AI:', error);
            return {
                success: false,
                message: 'An error occurred while calling the AI service.',
                
            };
        }
    }

    async findUserRecipes(userId: string) {
        try{
            const recipes = await this.userRecipeModel.find({ userid: userId }).exec();
            return {
                success: true,
                count: recipes.length,
                data: recipes
            };
        }
        catch(error){
            return {
                success: false,
                message: 'An error occurred while fetching user recipes.',
            }
        }
    }

    async createRecipe(recipeData: any) {
        try{
            const data = await this.userRecipeModel.create(recipeData);
            return {
                success: true,
                message: 'Recipe created successfully.',
                data: data
            };
        }
        catch(error){
            console.error('Error creating recipe:', error);
            return  {
                success: false,
                message: 'An error occurred while creating the recipe.',
                
            }
        }
    }
}
