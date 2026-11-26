'use strict';

/** Tutoriales con Solvix: qué tutoriales hizo u omitió cada usuario. Va en su cuenta, así lo encuentra igual en cualquier dispositivo. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('usuarios', 'tutoriales_json', { type: Sequelize.JSONB, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('usuarios', 'tutoriales_json');
  },
};
