import * as winston from 'winston';
import { utilities as nestWinstonModuleUtilities } from 'nest-winston';
import { OpenTelemetryTransportV3 } from '@opentelemetry/winston-transport';
import { logs } from '@opentelemetry/api-logs';

// Create Winston logger with OpenTelemetry support
export const createWinstonLogger = () => {
  // Get the global logger provider that was set up in instrumentation.ts
  const loggerProvider = logs.getLoggerProvider();
  
  console.log('Creating Winston logger. LoggerProvider available:', !!loggerProvider);

  const transports: winston.transport[] = [
    // Console transport with NestJS formatting
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.ms(),
        nestWinstonModuleUtilities.format.nestLike(
          process.env.OTEL_SERVICE_NAME || 'savefullapp',
          {
            colors: true,
            prettyPrint: true,
          }
        )
      ),
    }),
  ];

  // Only add OpenTelemetry transport if provider is available
  try {
    transports.push(
      new OpenTelemetryTransportV3()
    );
    console.log('✓ OpenTelemetry transport added to Winston');
  } catch (error) {
    console.error('✗ Failed to add OpenTelemetry transport:', error);
  }

  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.json()
    ),
    defaultMeta: {
      service: process.env.OTEL_SERVICE_NAME || 'savefullapp',
    },
    transports,
  });
};

export default createWinstonLogger;