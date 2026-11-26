'use strict';

/** Imagen de la cooperativa (logo o foto), que la gerencia puede cambiar. Va en tabla aparte: la fila de la cooperativa se lee en casi todos los pedidos y no tiene que cargar con la imagen. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, BLOB, DATE } = Sequelize;
    const now = Sequelize.literal('CURRENT_TIMESTAMP');
    await queryInterface.createTable('cooperativa_imagenes', {
      cooperativa_id: { type: INTEGER, primaryKey: true, references: { model: 'cooperativas', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      mime: { type: STRING(40), allowNull: false },
      contenido: { type: BLOB, allowNull: false },
      creado_el: { type: DATE, allowNull: false, defaultValue: now },
      actualizado_el: { type: DATE, allowNull: false, defaultValue: now },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('cooperativa_imagenes');
  },
};
