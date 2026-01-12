import * as winston from 'winston';
import { utilities as nestWinstonModuleUtilities } from 'nest-winston';
import { OpenTelemetryTransportV3 } from '@opentelemetry/winston-transport';

// Create Winston logger with OpenTelemetry support
export const createWinstonLogger = () => {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.json()
    ),
    defaultMeta: {
      service: process.env.OTEL_SERVICE_NAME || 'my-nestjs-app',
    },
    transports: [
      // Console transport with NestJS formatting
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.ms(),
          nestWinstonModuleUtilities.format.nestLike(
            process.env.OTEL_SERVICE_NAME || 'my-nestjs-app',
            {
              colors: true,
              prettyPrint: true,
            }
          )
        ),
      }),
      // OpenTelemetry transport - automatically sends logs to OTLP endpoint
      new OpenTelemetryTransportV3(),
    ],
  });
};

export default createWinstonLogger;