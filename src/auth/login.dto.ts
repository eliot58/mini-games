import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class LoginDto {
    @ApiProperty()
    @IsString()
    initData: string;

    @ApiProperty({ required: false })
    @IsString()
    @IsOptional()
    invited_by?: string;
}