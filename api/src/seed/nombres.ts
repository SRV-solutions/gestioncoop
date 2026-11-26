// Listas para armar nombres de prueba verosímiles para Misiones (apellidos criollos y de inmigración
// alemana, polaca, ucraniana y brasileña). Las combinaciones salen al azar: cualquier parecido con
// una persona real es casualidad. Ningún dato sale de padrones reales (SPEC sección 9).

export const NOMBRES_F = [
  'María', 'Ana', 'Marta', 'Rosa', 'Elena', 'Silvia', 'Claudia', 'Norma', 'Gladys', 'Mirta', 'Susana', 'Olga', 'Graciela',
  'Liliana', 'Patricia', 'Mónica', 'Andrea', 'Noelia', 'Carolina', 'Valeria', 'Lorena', 'Natalia', 'Romina', 'Yanina',
  'Daniela', 'Florencia', 'Camila', 'Micaela', 'Rocío', 'Sofía', 'Ramona', 'Irma', 'Elsa', 'Nélida', 'Teresa', 'Juana',
  'Beatriz', 'Alicia', 'Estela', 'Zulma', 'Griselda', 'Viviana', 'Karina', 'Gisela', 'Lucía', 'Agustina', 'Antonia',
] as const;

export const NOMBRES_M = [
  'Juan', 'José', 'Carlos', 'Luis', 'Jorge', 'Ramón', 'Miguel', 'Pedro', 'Hugo', 'Julio', 'Oscar', 'Roberto', 'Daniel',
  'Ricardo', 'Mario', 'Héctor', 'Rubén', 'Sergio', 'Pablo', 'Diego', 'Marcelo', 'Gustavo', 'Fabián', 'Cristian', 'Sebastián',
  'Matías', 'Nicolás', 'Lucas', 'Franco', 'Emanuel', 'Alberto', 'Antonio', 'Eduardo', 'Víctor', 'Néstor', 'Osvaldo',
  'Raúl', 'Enrique', 'Alfredo', 'Ernesto', 'Walter', 'Ariel', 'Leandro', 'Maximiliano', 'Gabriel', 'Javier', 'Esteban',
] as const;

export const APELLIDOS = [
  'Benítez', 'Sosa', 'Giménez', 'Rojas', 'Duarte', 'Ferreyra', 'Acosta', 'Ayala', 'Villalba', 'Medina', 'Franco', 'Cabral',
  'González', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'Gómez', 'Díaz', 'Romero', 'Ramírez', 'Núñez', 'Aguirre',
  'Cardozo', 'Vera', 'Silva', 'Da Silva', 'Dos Santos', 'De Lima', 'Pereira', 'Olivera', 'Machado', 'Ortiz', 'Báez',
  'Paredes', 'Ojeda', 'Figueredo', 'Barrios', 'Escobar', 'Leiva', 'Zarza', 'Portillo', 'Alvez', 'Antúnez', 'Maidana',
  'Krause', 'Wagner', 'Schmidt', 'Müller', 'Weber', 'Hoffmann', 'Becker', 'Schulz', 'Zimmermann', 'Kramer', 'Neumann',
  'Lukoski', 'Kowalski', 'Nowak', 'Zajaczkowski', 'Wisniewski', 'Sawicki', 'Dombrowski', 'Koslowski', 'Rybak',
  'Shevchuk', 'Melnik', 'Bondar', 'Hryniuk', 'Kozak', 'Semeniuk', 'Prestes', 'Rauber', 'Dressler', 'Feltes', 'Hippler',
] as const;

export const PARENTESCOS = ['Cónyuge', 'Hijo/a', 'Hijo/a', 'Hijo/a', 'Madre', 'Padre', 'Hermano/a'] as const;

/** Comercios y empresas: `{a}` se reemplaza por un apellido y `{n}` por un nombre de fantasía. */
export const COMERCIOS = [
  'Almacén {n}', 'Kiosco {n}', 'Despensa {n}', 'Autoservicio {n}', 'Ferretería {n}', 'Panadería {n}', 'Carnicería {n}',
  'Farmacia {n}', 'Taller Mecánico {a}', 'Gomería {a}', 'Aserradero {a} Hnos. S.R.L.', 'Secadero de Té {a} S.A.',
  'Yerbatera {n} S.R.L.', 'Agropecuaria {a} S.A.', 'Forrajería {n}', 'Corralón {a}', 'Tienda {n}', 'Hospedaje {n}',
  'Comedor {n}', 'Lubricentro {a}', 'Carpintería {a}', 'Vivero {n}', 'Estación de Servicio {n} S.R.L.', 'Metalúrgica {a}',
] as const;

export const FANTASIAS = [
  'El Lapacho', 'Don Pedro', 'La Esquina', 'El Colono', 'Tierra Colorada', 'La Familia', 'El Timbó', 'Los Hermanos',
  'El Amanecer', 'La Selva', 'El Ceibo', 'Doña Rosa', 'El Paraíso', 'Monte Verde', 'La Ruta', 'El Progreso', 'San Cayetano',
  'La Picada', 'El Yerbal', 'Guatambú', 'Mainumby', 'El Mirador', 'La Colonia', 'Sol Naciente',
] as const;

/** Instituciones. `oficial` y `bien_publico` son categorías tarifarias (SPEC 6.4). */
export const ENTIDADES: { nombre: string; categoria: 'oficial' | 'bien_publico' }[] = [
  { nombre: 'Escuela Provincial N° {num}', categoria: 'oficial' },
  { nombre: 'Aula Satélite N° {num}', categoria: 'oficial' },
  { nombre: 'Puesto de Salud {n}', categoria: 'oficial' },
  { nombre: 'Destacamento Policial {n}', categoria: 'oficial' },
  { nombre: 'Salón de Usos Múltiples {n}', categoria: 'oficial' },
  { nombre: 'Capilla {s}', categoria: 'bien_publico' },
  { nombre: 'Iglesia Evangélica {n}', categoria: 'bien_publico' },
  { nombre: 'Club Social y Deportivo {n}', categoria: 'bien_publico' },
  { nombre: 'Comisión Vecinal {n}', categoria: 'bien_publico' },
  { nombre: 'Asociación de Productores {n}', categoria: 'bien_publico' },
];

export const SANTOS = ['San José', 'San Antonio', 'Santa Rita', 'San Miguel', 'Santa Lucía', 'San Roque', 'Virgen de Itatí'] as const;
