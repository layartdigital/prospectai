import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Uilson Távora' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'voce@empresa.com.br' })
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(160)
  email!: string;

  @ApiProperty({ example: 'UmaSenhaForte123', minLength: 10 })
  @IsString()
  @MinLength(10, { message: 'A senha precisa de pelo menos 10 caracteres' })
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: 'Minha Agência' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  tenantName!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'owner@demo.propectai.local' })
  @IsEmail({}, { message: 'E-mail inválido' })
  email!: string;

  @ApiProperty({ example: 'Demo@123456' })
  @IsString()
  @MinLength(1, { message: 'Informe a senha' })
  password!: string;
}
